import {promises as fsPromises} from 'fs';

// @ts-ignore
import mime from "mime";
import {Qiniu, Region, Uploader} from "kodo-s3-adapter-sdk";
import {Adapter, Part, StorageClass} from "kodo-s3-adapter-sdk/dist/adapter";
import {RecoveredOption} from "kodo-s3-adapter-sdk/dist/uploader";
import {NatureLanguage} from "kodo-s3-adapter-sdk/dist/uplog";

import Duration from "@common/const/duration";
import * as AppConfig from "@common/const/app-config";

import {BackendMode, Status, UploadedPart} from "./types";
import Base from "./base"
import * as Utils from "./utils";

// if change options, remember to check getInfoForSave()
interface RequiredOptions {
    clientOptions: {
        accessKey: string,
        secretKey: string,
        ucUrl: string,
        regions: Region[],
        backendMode: BackendMode,
    },

    from: Required<Utils.LocalPath>,
    to: Utils.RemotePath,
    region: string,

    overwrite: boolean,
    storageClassName: StorageClass["kodoName"],
    storageClasses: StorageClass[],

    userNatureLanguage: NatureLanguage,
}

interface OptionalOptions {
    maxConcurrency: number,
    resumeUpload: boolean,
    multipartUploadThreshold: number,
    multipartUploadSize: number,
    uploadSpeedLimit: number,
    uploadedId: string,
    uploadedParts: UploadedPart[],

    status: Status,

    prog: {
        total: number,
        loaded: number,
        resumable?: boolean,
    },

    message: string,
    isDebug: boolean,
}

export type Options = RequiredOptions & Partial<OptionalOptions>

const DEFAULT_OPTIONS: OptionalOptions = {
    maxConcurrency: 10,
    resumeUpload: false,
    multipartUploadThreshold: 100,
    multipartUploadSize: 8,
    uploadSpeedLimit: 0, // 0 means no limit
    uploadedId: "",
    uploadedParts: [],

    status: Status.Waiting,

    prog: {
        total: 0,
        loaded: 0,
    },

    message: "",
    isDebug: false,
};

export default class UploadJob extends Base {
    // TODO: static fromSaveInfo(persistInfo: PersistInfo): UploadJob


    // - create options -
    private readonly options: RequiredOptions & OptionalOptions

    // - for job save and log -
    readonly id: string
    readonly kodoBrowserVersion: string
    private isForceOverwrite: boolean = false

    // - for UI -
    private __status: Status
    // speed
    speedTimerId?: number = undefined
    speed: number = 0
    predictLeftTime: number = 0
    // message
    message: string

    // - for resume from break point -
    prog: OptionalOptions["prog"]
    uploadedId: string
    uploadedParts: UploadedPart[]

    constructor(config: Options) {
        super();
        this.id = `uj-${new Date().getTime()}-${Math.random().toString().substring(2)}`
        this.kodoBrowserVersion = AppConfig.app.version;

        this.options = {
            ...DEFAULT_OPTIONS,
            ...config,
        }

        this.__status = this.options.status;

        this.prog = {
            ...this.options.prog,
        }
        this.uploadedId = this.options.uploadedId;
        this.uploadedParts = [
            ...this.options.uploadedParts,
        ];

        this.message = this.options.message;

        // hook functions
        this.startUpload = this.startUpload.bind(this);
        this.handleProgress = this.handleProgress.bind(this);
        this.handlePartsInit = this.handlePartsInit.bind(this);
        this.handlePartPutted = this.handlePartPutted.bind(this);
    }

    get accessKey(): string {
        return this.options.clientOptions.accessKey;
    }

    // TypeScript specification (8.4.3) says...
    // > Accessors for the same member name must specify the same accessibility
    private set _status(value: Status) {
        this.__status = value;
        this.emit("statuschange", this.status);

        if (
            this.status === Status.Failed
            || this.status === Status.Stopped
            || this.status === Status.Finished
            || this.status === Status.Duplicated
        ) {
            clearInterval(this.speedTimerId);

            this.speed = 0;
            this.predictLeftTime = 0;
        }
    }

    get status(): Status {
        return this.__status
    }

    get isStopped(): boolean {
        return this.status !== Status.Running;
    }

    get uiData() {
        return {
            id: this.id,
            from: this.options.from,
            to: this.options.to,
            status: this.status,
            speed: this.speed,
            estimatedTime: this.predictLeftTime,
            progress: this.prog,
            message: this.message,
        }
    }

    async start(
        forceOverwrite: boolean = false,
    ): Promise<void> {
        if (this.status === Status.Running || this.status === Status.Finished) {
            return;
        }

        if (forceOverwrite) {
            this.isForceOverwrite = true;
        }

        if (this.options.isDebug) {
            console.log(`Try uploading ${this.options.from.path} to kodo://${this.options.to.bucket}/${this.options.to.key}`);
            // console.log(`[JOB] sched starting => ${JSON.stringify(job)}`)
        }

        this.message = ""

        this._status = Status.Running;

        // create client
        // TODO: reuse client
        const qiniu = new Qiniu(
            this.options.clientOptions.accessKey,
            this.options.clientOptions.secretKey,
            this.options.clientOptions.ucUrl,
            `Kodo-Browser/${this.kodoBrowserVersion}/ioutil`,
            this.options.clientOptions.regions,
        );
        const qiniuClient = qiniu.mode(
            // this.options.clientOptions.backendMode,
            's3',
            {
                appName: 'kodo-browser/ioutil',
                appVersion: this.kodoBrowserVersion,
                appNatureLanguage: this.options.userNatureLanguage,
                // disable uplog when use customize cloud
                // because there isn't a valid access key of uplog
                uplogBufferSize: this.options.clientOptions.ucUrl ? -1 : undefined,
                requestCallback: () => {
                }, // TODO
                responseCallback: () => {
                }, // TODO
            },
        );

        // upload
        // this.startSpeedCounter();
        await qiniuClient.enter(
            'uploadFile',
            this.startUpload,
            {
                targetBucket: this.options.to.bucket,
                targetKey: this.options.to.key,
            },
        ).catch(err => {
            this._status = Status.Failed;
            this.message = err.toString();
        });
    }

    private async startUpload(client: Adapter) {
        client.storageClasses = this.options.storageClasses;
        const isOverwrite = this.isForceOverwrite || this.options.overwrite;
        if (!isOverwrite) {
            const isExists = await client.isExists(
                this.options.region,
                {
                    bucket: this.options.to.bucket,
                    key: this.options.to.key,
                },
            );
            if (isExists) {
                this._status = Status.Duplicated;
                return;
            }
        }

        const uploader = new Uploader(client);
        const fileHandle = await fsPromises.open(this.options.from.path, 'r');
        // console.log(
        //     "lihs debug:",
        //     "putObjectFromFile args",
        //     this.options.region,
        //     {
        //         bucket: this.options.to.bucket,
        //         key: this.options.to.key,
        //         storageClassName: this.options.storageClassName,
        //     },
        //     fileHandle,
        //     this.options.from.size,
        //     this.options.from.name,
        //     {
        //         header: {
        //             contentType: mime.getType(this.options.from.path)
        //         },
        //         recovered: {
        //             uploadId: this.uploadedId,
        //             parts: this.uploadedParts,
        //         },
        //         uploadThreshold: this.options.multipartUploadThreshold,
        //         partSize: this.options.multipartUploadSize,
        //         putCallback: {
        //             partsInitCallback: this.handlePartsInit,
        //             partPutCallback: this.handlePartPutted,
        //             progressCallback: this.handleProgress,
        //         },
        //         uploadThrottleOption: this.options.uploadSpeedLimit > 0
        //             ? {
        //                 rate: this.options.uploadSpeedLimit * 1024,
        //             }
        //             : undefined,
        //     },
        // );
        await uploader.putObjectFromFile(
            this.options.region,
            {
                bucket: this.options.to.bucket,
                key: this.options.to.key,
                storageClassName: this.options.storageClassName,
            },
            fileHandle,
            this.options.from.size,
            this.options.from.name,
            {
                header: {
                    contentType: mime.getType(this.options.from.path)
                },
                recovered: {
                    uploadId: this.uploadedId,
                    parts: this.uploadedParts,
                },
                uploadThreshold: this.options.multipartUploadThreshold,
                partSize: this.options.multipartUploadSize,
                putCallback: {
                    partsInitCallback: this.handlePartsInit,
                    partPutCallback: this.handlePartPutted,
                    progressCallback: this.handleProgress,
                },
                uploadThrottleOption: this.options.uploadSpeedLimit > 0
                    ? {
                        rate: this.options.uploadSpeedLimit * 1024,
                    }
                    : undefined,
            }
        );
        this._status = Status.Finished;

        await fileHandle.close();
    }

    stop(): this {
        if (this.status === Status.Stopped) {
            return this;
        }

        if (this.options.isDebug) {
            console.log(`Pausing ${this.options.from.path}`);
        }

        clearInterval(this.speedTimerId);

        this.speed = 0;
        this.predictLeftTime = 0;

        this._status = Status.Stopped;

        return this;
    }

    wait(): this {
        if (this.status === Status.Waiting) {
            return this;
        }

        if (this.options.isDebug) {
            console.log(`Pending ${this.options.from.path}`);
        }

        this._status = Status.Waiting;

        return this;
    }

    // @ts-ignore
    private startSpeedCounter() {
        const startedAt = new Date().getTime();

        let lastLoaded = this.prog.loaded;
        let lastSpeed = 0;

        clearInterval(this.speedTimerId);
        const intervalDuration = Duration.Second;
        this.speedTimerId = setInterval(() => {
            if (this.isStopped) {
                this.speed = 0;
                this.predictLeftTime = 0;
                return;
            }

            const avgSpeed = this.prog.loaded / (new Date().getTime() - startedAt) * Duration.Second;
            this.speed = this.prog.loaded - lastLoaded;
            if (this.speed <= 0 || (lastSpeed / this.speed) > 1.1) {
                this.speed = lastSpeed * 0.95;
            }
            if (this.speed < avgSpeed) {
                this.speed = avgSpeed;
            }

            lastLoaded = this.prog.loaded;
            lastSpeed = this.speed;


            if (this.options.uploadSpeedLimit && this.speed > this.options.uploadSpeedLimit * 1024) {
                this.speed = this.options.uploadSpeedLimit * 1024;
            }

            this.predictLeftTime = this.speed <= 0
                ? 0
                : Math.floor((this.prog.total - this.prog.loaded) / this.speed * 1000);
        }, intervalDuration) as unknown as number; // hack type problem of nodejs and browser
    }

    private handleProgress(uploaded: number, total: number) {
        // TODO: abort return
        this.prog.loaded = uploaded;
        this.prog.total = total;
        console.log("lihs debug:", "upload progress", (uploaded / total * 100).toFixed(2), "%");
        // TODO: should try save progress
    }

    private handlePartsInit(initInfo: RecoveredOption) {
        this.uploadedId = initInfo.uploadId;
        this.uploadedParts = initInfo.parts;
    }

    private handlePartPutted(part: Part) {
        // TODO: abort return
        this.uploadedParts[part.partNumber] = part;
        console.log("lihs debug:", "parts updated", part);
        // TODO: should try save progress
    }

    getInfoForSave({
        from
    }: {
        from?: {
            size?: number,
            mtime?: number,
        }
    }) {
        return {
            from: {
                ...this.options.from,
                ...from,
            },

            // read-only info
            storageClasses: this.options.storageClasses,
            region: this.options.region,
            to: this.options.to,
            overwrite: this.options.overwrite,
            storageClassName: this.options.storageClassName,
            backendMode: this.options.clientOptions.backendMode,

            // real-time info
            prog: {
                loaded: this.prog.loaded,
                total: this.prog.total,
                resumable: this.prog.resumable
            },
            status: this.status,
            message: this.message,
            uploadedId: this.uploadedId,
            uploadedParts: this.uploadedParts.map((part) => {
                return {PartNumber: part.partNumber, ETag: part.etag};
            }),
        };
    }
}

