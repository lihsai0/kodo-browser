import { Qiniu, Region } from "kodo-s3-adapter-sdk";
import { StorageClass } from "kodo-s3-adapter-sdk/dist/adapter";
import { NatureLanguage } from "kodo-s3-adapter-sdk/dist/uplog";

import Duration from "@common/const/duration";
import * as AppConfig from "@common/const/app-config";

import { BackendMode, EventKey, Status, UploadedPart } from "./types";
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

    from: Utils.LocalPath,
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
            from: this.options.from,
            to: this.options.to,
            status: this.status,
            speed: this.speed,
            estimatedTime: this.predictLeftTime,
            progress: this.prog,
            message: this.message,
        }
    }

    start(
        forceOverwrite: boolean = false,
    ): this {
        if (this.status === Status.Running || this.status === Status.Finished) {
            return this;
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

        // TODO: uploadFile

        this.startSpeedCounter();

        return this;
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
        this.emit("stop");

        // ipcRenderer.send("asynchronous-job", {
        //     job: this.id,
        //     key: IpcJobEvent.Stop,
        // });
        // ipcRenderer.removeListener(this.id, this.startUpload);

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
        this.emit("pause");

        return this;
    }

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
            this.emit('speedchange', this.speed * 1.2);

            this.predictLeftTime = this.speed <= 0
                ? 0
                : Math.floor((this.prog.total - this.prog.loaded) / this.speed * 1000);
        }, intervalDuration) as unknown as number; // hack type problem of nodejs and browser
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
                return { PartNumber: part.partNumber, ETag: part.etag };
            }),
        };
    }
}

