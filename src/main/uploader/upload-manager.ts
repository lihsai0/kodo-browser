import path from "path";
import fs, {Stats} from "fs";
import lodash from "lodash";
// @ts-ignore
import Walk from "@root/walk";

import ByteSize from "@common/const/byte-size";
import {UploadJob} from "@common/models/job";
import {ClientOptions, DestInfo, UploadOptions} from "@common/ipc-actions/upload";
import {Status} from "@common/models/job/types";
import {MAX_MULTIPART_COUNT, MIN_MULTIPART_SIZE} from "./boundary-const";

// for walk
interface StatsWithName extends Stats {
    name: string,
}

// Manager
interface ManagerConfig {
    resumeUpload: boolean,
    maxConcurrency: number,
    multipartUploadSize: number, // Bytes
    multipartUploadThreshold: number, // Bytes
    uploadSpeedLimit: number, // Bytes/s
    isDebug: boolean,
    // TODO: check if need be required. seems shouldn't persist, if don't remember user
    persistPath: string,

    onError: (err: Error) => void,
}

const defaultManagerConfig: ManagerConfig = {
    isDebug: false,
    maxConcurrency: 10,
    multipartUploadSize: 4 * ByteSize.MB, // 4MB
    multipartUploadThreshold: 10 * ByteSize.MB, // 10MB
    resumeUpload: false,
    uploadSpeedLimit: 0,
    persistPath: "",
    onError: () => {},
}

export default class UploadManager {
    private concurrency: number = 0;
    private jobs: Map<UploadJob["id"], UploadJob> = new Map<UploadJob["id"], UploadJob>()
    private jobIds: UploadJob["id"][] = []
    private config: Readonly<ManagerConfig>

    constructor(config: Partial<ManagerConfig>) {
        this.config = {
            ...defaultManagerConfig,
            ...config,
        };
    }

    get jobsLength() {
        return this.jobIds.length;
    }

    get jobsSummary(): {
        total: number,
        finished: number,
        running: number,
        failed: number,
        stopped: number,
    } {
        let finished = 0;
        let failed = 0;
        let stopped = 0;
        this.jobIds.forEach((id) => {
            switch (this.jobs.get(id)?.status) {
                case Status.Finished: {
                    finished += 1;
                    break;
                }
                case Status.Failed: {
                    failed += 1;
                    break;
                }
                case Status.Stopped: {
                    stopped += 1;
                    break;
                }
            }
        });
        return {
            total: this.jobIds.length,
            finished: finished,
            running: this.concurrency,
            failed: failed,
            stopped: stopped,
        }
    }

    updateConfig(config: Partial<ManagerConfig>) {
        this.config = {
            ...this.config,
            ...config,
        };
    }

    async createUploadJobs(
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
            // TODO:
            //  can't use walk because we need to determine whether the directory is empty.
            //  and in this electron version(nodejs v10.x) must read the directory again.
            //  it's too waste.
            await walk(
                filePathname,
                async (err: Error, walkingPathname: string, statsWithName: StatsWithName): Promise<void> => {
                    if (err) {
                        this.config.onError(err);
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
                        console.log("lihs debug:", "uploadOptions", uploadOptions);
                        console.log("lihs debug:", "clientOptions", clientOptions);
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
                        this.createUploadJob(from, to, uploadOptions, clientOptions);
                        console.groupEnd();

                        // post add job
                        hooks?.jobsAdding?.();
                        this.scheduleJobs();
                    } else {
                        console.warn("file can't upload", "local:", walkingPathname, "remoteKey:", remoteKey);
                    }
                },
            );
        }
        hooks?.jobsAdded?.();
    }

    private createUploadJob(
        from: Required<UploadJob["options"]["from"]>,
        to: UploadJob["options"]["to"],
        uploadOptions: UploadOptions,
        clientOptions: ClientOptions,
    ): void {
        // TODO: parts count and part size should move to sdk?
        // parts count
        const partsCount = Math.ceil(from.size / this.config.multipartUploadSize);

        // part size
        let partSize = this.config.multipartUploadSize;
        if (partsCount > MAX_MULTIPART_COUNT) {
            partSize = Math.ceil(from.size / MAX_MULTIPART_COUNT);
            if (partSize < MIN_MULTIPART_SIZE) {
                partSize = MIN_MULTIPART_SIZE
            } else {
                // Why?
                partSize += MIN_MULTIPART_SIZE - partSize % MIN_MULTIPART_SIZE
            }
        }

        const job = new UploadJob({
            from: from,
            to: to,
            prog: {
                loaded: 0,
                total: from.size,
                resumable: this.config.resumeUpload && from.size > this.config.multipartUploadThreshold,
            },

            clientOptions: {
                accessKey: clientOptions.accessKey,
                secretKey: clientOptions.secretKey,
                ucUrl: clientOptions.ucUrl,
                regions: clientOptions.regions,
                backendMode: clientOptions.backendMode,
            },
            storageClasses: uploadOptions.storageClasses,

            overwrite: uploadOptions.isOverwrite,
            region: uploadOptions.regionId,
            storageClassName: uploadOptions.storageClassName,

            multipartUploadSize: partSize,
            multipartUploadThreshold: this.config.multipartUploadThreshold,
            uploadSpeedLimit: this.config.uploadSpeedLimit,
            isDebug: this.config.isDebug,

            userNatureLanguage: uploadOptions.userNatureLanguage,
        });

        this.addJob(job);
    }

    private addJob(job: UploadJob) {
        job.on("partcomplete", () => {
            this.persistJobs();
            return false;
        });
        job.on("complete", () => {
            console.log("lihs debug:", "complete");
            this.persistJobs();
            return false;
        });

        this.jobs.set(job.id, job);
        this.jobIds.push(job.id);
    }

    public getJobsUiDataByPage(pageNum: number = 0, count: number = 10, query?: { status?: Status, name?: string }) {
        let list;
        if (query) {
            list = this.jobIds.map(id => this.jobs.get(id)?.uiData)
                .filter(job => {
                    const matchStatus = query.status
                        ? job?.status === query.status
                        : true;
                    const matchName = query.name
                        ? job?.from.name.includes(query.name)
                        : true;
                    return matchStatus && matchName;
                })
                .slice(pageNum, pageNum * count + count);
        } else {
            list = this.jobIds.slice(pageNum, pageNum * count + count)
                .map(id => this.jobs.get(id)?.uiData);
        }
        return {
            list,
            ...this.jobsSummary,
        };
    }

    public getJobsUiDataByIds(ids: UploadJob["id"][]) {
        return {
            list: ids.filter(id => this.jobs.has(id))
                .map(id => this.jobs.get(id)?.uiData),
            ...this.jobsSummary,
        };
    }

    public persistJobs(force: boolean = false): void {
        if (force) {
            console.log("lihs debug:", "_persistJobs force");
            this._persistJobs();
            return;
        }
        this._persistJobsThrottle();
    }

    private _persistJobsThrottle = lodash.throttle(this._persistJobs, 1000);

    private _persistJobs(): void {
        console.log("lihs debug:", "_persistJobs");
        if (!this.config.persistPath) {
            return;
        }
        const persistData: Record<string, UploadJob["persistInfo"]> = {};
        this.jobIds.forEach(id => {
            const job = this.jobs.get(id);
            if (!job || job.status === Status.Finished) {
                return;
            }
            persistData[id] = job.persistInfo;
        });
        fs.writeFileSync(
            this.config.persistPath,
            JSON.stringify(persistData),
        );
    }

    public loadJobsFromStorage(
        clientOptions: Pick<ClientOptions, "accessKey" | "secretKey" | "ucUrl" | "regions">,
        uploadOptions: Pick<UploadOptions, "userNatureLanguage">
    ): void {
        if (!this.config.persistPath) {
            return;
        }
        const persistedJobs: Record<string, UploadJob["persistInfo"]> = JSON.parse(fs.readFileSync(this.config.persistPath, "utf-8"));
        Object.entries(persistedJobs)
            .forEach(([jobId, persistedJob]) => {
                if (this.jobs.get(jobId)) {
                    return
                }

                if (!persistedJob.from) {
                    this.config.onError(new Error("load jobs from storage error: lost job.from"));
                    return;
                }

                if (!fs.existsSync(persistedJob.from.path)) {
                    this.config.onError(new Error(`load jobs from storage error: local file not found\nfile path: ${persistedJob.from.path}`));
                    return;
                }

                // TODO: Is the `if` useless? Why `size` or `mtime` doesn't exist?
                if (!persistedJob.from?.size || !persistedJob.from?.mtime) {
                    persistedJob.prog.loaded = 0;
                    persistedJob.uploadedParts = [];
                }

                const fileStat = fs.statSync(persistedJob.from.path);
                if (
                    fileStat.size !== persistedJob.from.size ||
                    Math.floor(fileStat.mtimeMs) !== persistedJob.from.mtime
                ) {
                    persistedJob.from.size = fileStat.size;
                    persistedJob.from.mtime = Math.floor(fileStat.mtimeMs);
                    persistedJob.prog.loaded = 0;
                    persistedJob.prog.total = fileStat.size;
                    persistedJob.uploadedParts = [];
                }

                // resumable
                // Why not follow persisted resumeUpload?
                persistedJob.prog.resumable = this.config.resumeUpload && persistedJob.from.size > this.config.multipartUploadThreshold;

                const job = UploadJob.fromPersistInfo(
                    jobId,
                    persistedJob,
                    {
                        ...clientOptions,
                        backendMode: persistedJob.backendMode,
                    },
                    uploadOptions.userNatureLanguage,
                );

                if (job.status === Status.Running) {
                    job.stop();
                }

                this.addJob(job);
            });
    }

    public waitJob(jobId: string): void {
        this.jobs.get(jobId)?.wait();
        this.scheduleJobs();
    }

    public startJob(jobId: string, forceOverwrite: boolean = false): void {
        this.jobs.get(jobId)?.start(forceOverwrite);
    }

    public stopJob(jobId: string): void {
        this.jobs.get(jobId)?.stop();
    }

    public removeJob(jobId: string): void {
        const indexToRemove = this.jobIds.indexOf(jobId);
        if (indexToRemove < 0) {
            return;
        }
        this.jobs.get(jobId)?.stop();
        this.jobIds.splice(indexToRemove, 1);
        this.jobs.delete(jobId);
    }

    public cleanupJobs(): void {
        const idsToRemove = this.jobIds.filter(id => this.jobs.get(id)?.status === Status.Finished);
        this.jobIds = this.jobIds.filter(id => !idsToRemove.includes(id));
        idsToRemove.forEach(id => {
            this.jobs.delete(id);
        });
    }

    public startAllJobs(): void {
        this.jobIds
            .map(id => this.jobs.get(id))
            .forEach(job => {
                if (!job) {
                    return;
                }
                if ([
                    Status.Stopped,
                    Status.Failed,
                ].includes(job.status)) {
                    job.wait();
                }
            });
        this.scheduleJobs();
    }

    public stopAllJobs(): void {
        this.jobIds
            .map(id => this.jobs.get(id))
            .forEach(job => {
                if (!job) {
                    return;
                }
                job.stop();
            });
    }

    public removeAllJobs(): void {
        this.stopAllJobs();
        this.jobIds = [];
        this.jobs.clear();
    }

    private scheduleJobs(): void {
        if (this.config.isDebug) {
            console.log(`[JOB] upload max: ${this.config.maxConcurrency}, cur: ${this.concurrency}, jobs: ${this.jobIds.length}`);
        }

        this.concurrency = Math.max(0, this.concurrency);
        if (this.concurrency >= this.config.maxConcurrency) {
            return;
        }

        for (let i = 0; i < this.jobIds.length; i++) {
            const job = this.jobs.get(this.jobIds[i]);
            if (job?.status !== Status.Waiting) {
                continue;
            }
            this.concurrency += 1;
            if (job.prog.resumable) {
                console.log("lihs debug:", "resumable", job.id);
            }
            console.log("lihs debug:", "job.start()");
            job.start()
                .catch(err => {
                    console.log("lihs debug:", "job.start() err:", err);
                })
                .finally(() => {
                    this.afterJobDone(job.id);
                });

            this.concurrency = Math.max(0, this.concurrency);
            if (this.concurrency >= this.config.maxConcurrency) {
                return;
            }
        }
    }

    private afterJobDone(id: UploadJob["id"]): void {
        console.log("lihs debug:", "job done", id);
        this.concurrency -= 1;
        this.scheduleJobs();
    }
}
