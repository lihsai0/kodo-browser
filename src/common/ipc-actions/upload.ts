import {IpcRenderer} from "electron";
import {Region} from "kodo-s3-adapter-sdk";
import {BackendMode} from "@common/models/job/types";

// TODO:
//  move to models
//  and replace src/renderer/components/services/qiniu-client/storage-class.ts
export interface StorageClass {
    fileType: number,
    kodoName: string,
    s3Name: string,
    billingI18n: Record<string, string>,
    nameI18n: Record<string, string>,
}

export interface DestInfo {
    bucketName: string,
    // regionId: string, // TODO: seems useless
    key: string,
}

export interface UploadOptions {
    regionId: string,
    isOverwrite: boolean,
    storageClassName: StorageClass["kodoName"],
}

export interface ClientOptions {
    accessKey: string,
    secretKey: string,
    ucUrl: string,
    regions: Region[],
    backendMode: BackendMode,
    storageClasses: StorageClass[],
}

export enum UploadAction {
    AddJobs = "AddJobs",
    UpdateUiData = "UpdateUiData",
}

export class UploadActionFns {
    constructor(
        private readonly ipc: IpcRenderer,
        private readonly channel: string,
    ) {
    }

    addJobs(data: {
        filePathnameList: string[],
        destInfo: DestInfo,
        uploadOptions: UploadOptions,
        clientOptions: ClientOptions,
    }) {
        this.ipc.send(this.channel, {
            action: UploadAction.AddJobs,
            data,
        })
    }

    updateUiData(data: {
        pageNum: number,
        count: number,
    }) {
        this.ipc.send(this.channel, {
            action: UploadAction.UpdateUiData,
            data,
        });
    }
}
