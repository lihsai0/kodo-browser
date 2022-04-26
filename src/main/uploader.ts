import {Stats} from "fs";
import path from "path";
// @ts-ignore
import Walk from "@root/walk";
import {Region} from "kodo-s3-adapter-sdk";

import {UploadJob} from "@common/models/job";
import {BackendMode, Status} from "@common/models/job/types";
// import { createClient } from "../common/qiniu-store/lib/ioutil";

// Manager
interface DestInfo {
    bucketName: string,
    // regionId: string, // TODO: seems useless
    key: string,
}

interface UploadOptions {
    regionId: string,
    isOverwrite: boolean,
    storageClassName: StorageClass["kodoName"],
}

interface ClientOptions {
    accessKey: string,
    secretKey: string,
    ucUrl: string,
    regions: Region[],
    backendMode: BackendMode,
    storageClasses: StorageClass[],
}

interface ManagerConfig {
    resumeUpload: boolean,
    maxConcurrency: number,
    multipartUploadSize: number,
    multipartUploadThreshold: number,
    uploadSpeedLimit: number, // KB/s
    isDebug: boolean,
}

interface StatsWithName extends Stats {
    name: string,
}

// TODO: src/renderer/components/services/qiniu-client/storage-class.ts
interface StorageClass {
    fileType: number,
    kodoName: string,
    s3Name: string,
    billingI18n: Record<string, string>,
    nameI18n: Record<string, string>,
}

const defaultManagerConfig: ManagerConfig = {
    isDebug: false,
    maxConcurrency: 1,
    multipartUploadSize: 0,
    multipartUploadThreshold: 0,
    resumeUpload: false,
    uploadSpeedLimit: 0,
}

function defaultJobsAdding() {
    console.log("jobsAdding");
}

function defaultJobsAdded() {
    console.log("jobsAdded");
    setExitTimer(5000);
}

class UploadManager {
    private static concurrency: number = 0;
    private static jobs: Map<UploadJob["id"], UploadJob> = new Map<UploadJob["id"], UploadJob>()
    private static jobIds: UploadJob["id"][] = []
    private static config: ManagerConfig = defaultManagerConfig

    static async createUploadJobs(
        filePathnameList: string[], // local file path, required absolute path
        destInfo: DestInfo,
        uploadOptions: UploadOptions,
        clientOptions: ClientOptions,
        hooks?: {
            jobsAdding?: () => void,
            jobsAdded?: () => void,
        },
    ) {
        const walk = Walk.create({
            withFileStats: true,
        });
        for (const filePathname of filePathnameList) {
            await walk(
                filePathname,
                async (err: Error, walkingPathname: string, statsWithName: StatsWithName): Promise<void> => {
                    if (err) {
                        // send err message
                        console.log("lihs debug:", "send error message");
                        return
                    }

                    const remoteBaseDirectory = destInfo.key.endsWith("/")
                        ? destInfo.key.slice(0, -1)
                        : destInfo.key;
                    const localParentDirectory = path.dirname(filePathname);
                    // TODO: check on windows, seems need .replace(/\\/, "/")
                    const remoteKey = remoteBaseDirectory + walkingPathname.slice(localParentDirectory.length);

                    if (statsWithName.isDirectory()) {
                        console.log("lihs debug:", "QiniuClient.createFolder()", remoteKey);
                    }
                    else if (statsWithName.isFile()) {
                        console.group("lihs debug:", "UploadManager.createUploadJob()", remoteKey);
                        // console.log("lihs debug:", "destInfo", destInfo);
                        // console.log("lihs debug:", "uploadOptions", uploadOptions);
                        // console.log("lihs debug:", "clientOptions", clientOptions);
                        const from = {
                            name: statsWithName.name,
                            path: walkingPathname,
                            size: statsWithName.size,
                            mtime: statsWithName.mtime.getTime(),
                        };
                        // console.log("lihs debug:", "from", from);
                        const to = {
                            bucket: destInfo.bucketName,
                            key: remoteKey,
                        };
                        // console.log("lihs debug:", "to", to);
                        UploadManager.createUploadJob(from, to, uploadOptions, clientOptions);
                        console.groupEnd();

                        // post add job
                        hooks?.jobsAdding ? hooks.jobsAdding() : defaultJobsAdding();
                        UploadManager.scheduleJobs();
                    } else {
                        console.group("lihs debug:", "file can't upload");
                        console.log("lihs debug:", "walkingPathname", walkingPathname);
                        console.log("lihs debug:", "remoteKey", remoteKey);
                        console.groupEnd();
                    }
                },
            );
        }
        hooks?.jobsAdded ? hooks.jobsAdded() : defaultJobsAdded();
    }

    private static createUploadJob(
        from: Required<UploadJob["options"]["from"]>,
        to: UploadJob["options"]["to"],
        uploadOptions: UploadOptions,
        clientOptions: ClientOptions,
    ): void {
        const job = new UploadJob({
            from: from,
            to: to,

            clientOptions: {
                accessKey: clientOptions.accessKey,
                secretKey: clientOptions.secretKey,
                ucUrl: clientOptions.ucUrl,
                regions: clientOptions.regions,
                backendMode: clientOptions.backendMode,
            },
            storageClasses: clientOptions.storageClasses,

            overwrite: uploadOptions.isOverwrite,
            region: uploadOptions.regionId,
            storageClassName: uploadOptions.storageClassName,

            resumeUpload: UploadManager.config.resumeUpload,
            multipartUploadSize: UploadManager.config.multipartUploadSize,
            multipartUploadThreshold: UploadManager.config.multipartUploadThreshold,
            uploadSpeedLimit: UploadManager.config.uploadSpeedLimit,
            isDebug: UploadManager.config.isDebug,

            userNatureLanguage: "zh-CN",
        });
        UploadManager.jobs.set(job.id, job);
        UploadManager.jobIds.push(job.id);
    }

    public static getJobsUiData(ids: UploadJob["id"][]) {
        return ids.filter(id => UploadManager.jobs.has(id))
            .map(id => UploadManager.jobs.get(id)?.uiData);
    }

    private static scheduleJobs(): void {
        if (UploadManager.config.isDebug) {
            console.log(`[JOB] upload max: ${UploadManager.config.maxConcurrency}, cur: ${UploadManager.concurrency}, jobs: ${UploadManager.jobIds.length}`);
        }

        UploadManager.concurrency = Math.max(0, UploadManager.concurrency);
        if (UploadManager.concurrency >= UploadManager.config.maxConcurrency) {
            return;
        }

        for (let i = 0; i < UploadManager.jobIds.length; i++) {
            const job = UploadManager.jobs.get(UploadManager.jobIds[i]);
            if (job?.status !== Status.Waiting) {
                continue;
            }
            UploadManager.concurrency += 1;
            // TODO: 变为 get 方法
            if (job.prog.resumable) {
                console.log("lihs debug:", "resumable", job.id);
            }
            console.log("lihs debug:", "job.start()");
            job.start();
            setTimeout(() => {
                UploadManager.afterJobDone(job.id);
            }, 600);
        }
    }

    private static afterJobDone(id: UploadJob["id"]): void {
        console.log("lihs debug:", "job done", id);
        UploadManager.jobs.delete(id);
        UploadManager.jobIds.splice(UploadManager.jobIds.indexOf(id), 1);
        UploadManager.concurrency -=1;
        UploadManager.scheduleJobs();
    }
}

interface MessageData {
    action: string,
    data: any,
}

process.on("uncaughtException", (err) => {
    console.error(err);
});

process.on("message", (message: MessageData) => {
    console.log("lihs debug:", "uploader received", message);
    switch (message.action) {
        case "addJobs": {
            UploadManager.createUploadJobs(
                message.data.filePathnameList,
                message.data.destInfo,
                message.data.uploadOptions,
                message.data.clientOptions,
            );
            break;
        }
        case "updateUiData": {
            process.send?.({
                action: "updateJobUiData",
                data: UploadManager.getJobsUiData(message.data),
            });
            break;
        }
        default: {
            console.warn("Upload Manager received unknown action, message:", message);
        }
    }
});

// if all jobs done, wait a while instead of exiting process.
let exitTimer: NodeJS.Timeout | undefined;

function resetExitTimer() {
    if (exitTimer !== undefined) {
        clearTimeout(exitTimer);
    }
}

function setExitTimer(msDuration: number) {
    resetExitTimer()
    exitTimer = setTimeout(() => {
        console.log("upload process exit, because no job to do in past", msDuration, "ms");
        process.exit(0);
    }, msDuration);
}
