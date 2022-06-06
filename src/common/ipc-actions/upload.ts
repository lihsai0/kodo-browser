import {IpcRenderer} from "electron";
import {Region} from "kodo-s3-adapter-sdk";
import {NatureLanguage} from "kodo-s3-adapter-sdk/dist/uplog";
import {BackendMode, Status} from "@common/models/job/types";
import StorageClass from "@common/models/storage-class";

// some types maybe should in models
export interface DestInfo {
    bucketName: string,
    // regionId: string, // TODO: seems useless
    key: string,
}

export interface UploadOptions {
    regionId: string,
    isOverwrite: boolean,
    storageClassName: StorageClass["kodoName"],
    storageClasses: StorageClass[],
    userNatureLanguage: NatureLanguage,
}

// TODO: merge with `RequiredOptions['clientOptions']` in upload-job.ts
export interface ClientOptions {
    accessKey: string,
    secretKey: string,
    ucUrl: string,
    regions: Region[],
    backendMode: BackendMode,
}

// action names
export enum UploadAction {
    UpdateConfig = "UpdateConfig",
    LoadPersistJobs = "LoadPersistJobs",
    AddJobs = "AddJobs",
    UpdateUiData = "UpdateUiData",
    StopJob = "StopJob",
    WaitJob = "WaitJob",
    StartJob = "StartJob",
    RemoveJob = "RemoveJob",
    CleanupJobs = "CleanupJobs",
    StartAllJobs = "StartAllJobs",
    StopAllJobs = "StopAllJobs",
    RemoveAllJobs = "RemoveAllJobs",
}

// actions with payload data
export interface UpdateConfigMessage {
    action: UploadAction.UpdateConfig,
    data: Partial<{
        resumeUpload: boolean,
        maxConcurrency: number,
        multipartUploadSize: number, // Bytes
        multipartUploadThreshold: number, // Bytes
        uploadSpeedLimit: number, // Bytes/s
        isDebug: boolean,
        persistPath: string,
    }>,
}

export interface LoadPersistJobsMessage {
    action: UploadAction.LoadPersistJobs,
    data: {
        clientOptions: Pick<ClientOptions, "accessKey" | "secretKey" | "ucUrl" | "regions">,
        uploadOptions: Pick<UploadOptions, "userNatureLanguage">,
    },
}

export interface AddJobsMessage {
    action: UploadAction.AddJobs,
    data: {
        filePathnameList: string[],
        destInfo: DestInfo,
        uploadOptions: UploadOptions,
        clientOptions: ClientOptions,
    },
}

export interface UpdateUiDataMessage {
    action: UploadAction.UpdateUiData,
    data: {
        pageNum: number,
        count: number,
        query?: { status?: Status, name?: string },
    },
}

export interface StopJobMessage {
    action: UploadAction.StopJob,
    data: {
        jobId: string,
    }
}

export interface WaitJobMessage {
    action: UploadAction.WaitJob,
    data: {
        jobId: string,
    }
}

export interface StartJobMessage {
    action: UploadAction.StartJob,
    data: {
        jobId: string,
        forceOverwrite?: boolean,
    }
}

export interface RemoveJobMessage {
    action: UploadAction.RemoveJob,
    data: {
        jobId: string,
    }
}

export interface CleanupJobMessage {
    action: UploadAction.CleanupJobs,
    data?: {}
}

export interface StartAllJobsMessage {
    action: UploadAction.StartAllJobs,
    data?: {}
}

export interface StopAllJobsMessage {
    action: UploadAction.StopAllJobs,
    data?: {}
}

export interface RemoveAllJobsMessage {
    action: UploadAction.RemoveAllJobs,
    data?: {}
}

export type UploadMessage = UpdateConfigMessage
    | LoadPersistJobsMessage
    | AddJobsMessage
    | UpdateUiDataMessage
    | StopJobMessage
    | WaitJobMessage
    | StartJobMessage
    | RemoveJobMessage
    | CleanupJobMessage
    | StartAllJobsMessage
    | StopAllJobsMessage
    | RemoveAllJobsMessage

// send actions functions
export class UploadActionFns {
    constructor(
        private readonly ipc: IpcRenderer,
        private readonly channel: string,
    ) {
    }

    updateConfig(data: UpdateConfigMessage['data']) {
        this.ipc.send(this.channel, {
            action: UploadAction.UpdateConfig,
            data,
        });
    }

    loadPersistJobs(data: LoadPersistJobsMessage['data']) {
        this.ipc.send(this.channel, {
            action: UploadAction.LoadPersistJobs,
            data,
        });
    }

    addJobs(data: AddJobsMessage['data']) {
        this.ipc.send(this.channel, {
            action: UploadAction.AddJobs,
            data,
        });
    }

    updateUiData(data: UpdateUiDataMessage['data']) {
        this.ipc.send(this.channel, {
            action: UploadAction.UpdateUiData,
            data,
        });
    }

    waitJob(data: WaitJobMessage['data']) {
        this.ipc.send(this.channel, {
            action: UploadAction.WaitJob,
            data,
        });
    }

    startJob(data: StartJobMessage['data']) {
        this.ipc.send(this.channel, {
            action: UploadAction.StartJob,
            data,
        });
    }

    stopJob(data: StopJobMessage['data']) {
        this.ipc.send(this.channel, {
            action: UploadAction.StopJob,
            data,
        });
    }

    removeJob(data: RemoveJobMessage['data']) {
        this.ipc.send(this.channel, {
            action: UploadAction.RemoveJob,
            data,
        });
    }

    cleanUpJobs() {
        this.ipc.send(this.channel, {
            action: UploadAction.CleanupJobs,
            data: {},
        });
    }

    startAllJobs() {
        this.ipc.send(this.channel, {
            action: UploadAction.StartAllJobs,
            data: {},
        });
    }

    stopAllJobs() {
        this.ipc.send(this.channel, {
            action: UploadAction.StopAllJobs,
            data: {},
        });
    }

    removeAllJobs() {
        this.ipc.send(this.channel, {
            action: UploadAction.RemoveAllJobs,
            data: {},
        });
    }
}
