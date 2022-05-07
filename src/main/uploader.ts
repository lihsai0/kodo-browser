import fs, {Stats} from "fs";
import path from "path";
// @ts-ignore
import Walk from "@root/walk";

import {config_path} from "@common/const/app-config";
import {ClientOptions, DestInfo, UploadAction, UploadOptions} from "@common/ipc-actions/upload";
import {UploadJob} from "@common/models/job";
import {Status} from "@common/models/job/types";

// Manager
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

const defaultManagerConfig: ManagerConfig = {
    isDebug: false,
    maxConcurrency: 10,
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

                    // remoteKey should be "path/to/file"
                    // TODO: check on windows, seems need .replace(/\\/, "/")
                    let remoteKey = remoteBaseDirectory + walkingPathname.slice(localParentDirectory.length);
                    remoteKey = remoteKey.startsWith("/") ? remoteKey.slice(1) : remoteKey;

                    if (statsWithName.isDirectory()) {
                        console.log("lihs debug:", "QiniuClient.createFolder()", remoteKey);
                    } else if (statsWithName.isFile()) {
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

    public static getJobsUiDataByPage(pageNum: number = 0, count: number = 10) {
        return {
            list: UploadManager.jobIds.slice(pageNum, pageNum * count + count)
                .map(id => UploadManager.jobs.get(id)?.uiData),
            // TODO: statSummary get method
            total: UploadManager.jobIds.length,
            finished: UploadManager.jobIds.filter(id => UploadManager.jobs.get(id)?.status === Status.Finished).length,
            running: UploadManager.concurrency,
            failed: UploadManager.jobIds.filter(id => UploadManager.jobs.get(id)?.status === Status.Failed).length,
            stopped: UploadManager.jobIds.filter(id => UploadManager.jobs.get(id)?.status === Status.Stopped).length,
        };
    }

    public static getJobsUiDataByIds(ids: UploadJob["id"][]) {
        return {
            list: ids.filter(id => UploadManager.jobs.has(id))
                .map(id => UploadManager.jobs.get(id)?.uiData),
            // TODO: statSummary get method
            total: UploadManager.jobIds.length,
            finished: UploadManager.jobIds.filter(id => UploadManager.jobs.get(id)?.status === Status.Finished).length,
            running: UploadManager.concurrency,
            failed: UploadManager.jobIds.filter(id => UploadManager.jobs.get(id)?.status === Status.Failed).length,
            stopped: UploadManager.jobIds.filter(id => UploadManager.jobs.get(id)?.status === Status.Stopped).length,
        };
    }

    public static persistJobs(): void {
        if (UploadManager.jobIds.length <= 0) {
            return
        }
        // TODO: support multiple users or move auth data to main from renderer
        const username = UploadManager.jobs.get(UploadManager.jobIds[0])?.accessKey;
        const jobsPath = path.join(config_path, "upprog_" + username + ".json");
        fs.writeFileSync(
            jobsPath,
            JSON.stringify(
                UploadManager.jobIds.map(id => UploadManager.jobs.get(id)?.getInfoForSave({}))
            ),
        );
    }

    public static loadJobsFromStorage(): void {
        // TODO
        // fs.readFileSync();
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
            job.start()
                .catch(err => {
                    console.log("lihs debug:", "job.start() err:", err);
                })
                .finally(() => {
                    UploadManager.afterJobDone(job.id);
                });

            UploadManager.concurrency = Math.max(0, UploadManager.concurrency);
            if (UploadManager.concurrency >= UploadManager.config.maxConcurrency) {
                return;
            }
        }
    }

    private static afterJobDone(id: UploadJob["id"]): void {
        console.log("lihs debug:", "job done", id);
        // UploadManager.jobs.delete(id);
        // UploadManager.jobIds.splice(UploadManager.jobIds.indexOf(id), 1);
        UploadManager.concurrency -= 1;
        UploadManager.scheduleJobs();
    }
}

// TODO: no any, move to @common/ipc-actions/upload.ts
interface MessageData {
    action: string,
    data: any,
}

process.on("uncaughtException", (err) => {
    console.error(err);
});

process.on("message", (message: MessageData) => {
    // console.log("lihs debug:", "uploader received", message);
    switch (message.action) {
        case UploadAction.AddJobs: {
            UploadManager.createUploadJobs(
                message.data.filePathnameList,
                message.data.destInfo,
                message.data.uploadOptions,
                message.data.clientOptions,
            );
            break;
        }
        case UploadAction.UpdateUiData: {
            process.send?.({
                action: UploadAction.UpdateUiData,
                data: UploadManager.getJobsUiDataByPage(
                    message.data.pageNum,
                    message.data.count,
                ),
            });
            break;
        }
        default: {
            console.warn("Upload Manager received unknown action, message:", message);
        }
    }
});

// process.on("exit", () => {
//
// });
//
// // if all jobs done, wait a while instead of exiting process.
// let exitTimer: NodeJS.Timeout | undefined;
//
// function resetExitTimer() {
//     if (exitTimer !== undefined) {
//         clearTimeout(exitTimer);
//     }
// }
//
// function setExitTimer(msDuration: number) {
//     resetExitTimer()
//     exitTimer = setTimeout(() => {
//         console.log("upload process exit, because no job to do in past", msDuration, "ms");
//         process.exit(0);
//     }, msDuration);
// }
