import {UploadAction, UploadMessage} from "@common/ipc-actions/upload";
import UploadManager from "./upload-manager";

// initial UploadManager Config from argv after `--config-json`
const configStr = process.argv.find((_arg, i, arr) => arr[i - 1] === "--config-json");
const uploadManagerConfig = configStr ? JSON.parse(configStr) : {};
const uploadManager = new UploadManager(uploadManagerConfig);

process.on("uncaughtException", (err) => {
    uploadManager.persistJobs(true);
    console.error(err);
});

process.on("message", (message: UploadMessage) => {
    switch (message.action) {
        case UploadAction.UpdateConfig: {
            uploadManager.updateConfig(message.data);
            break;
        }
        case UploadAction.LoadPersistJobs: {
            uploadManager.loadJobsFromStorage(
                message.data.clientOptions,
                message.data.uploadOptions,
            );
            break;
        }
        case UploadAction.AddJobs: {
            uploadManager.createUploadJobs(
                message.data.filePathnameList,
                message.data.destInfo,
                message.data.uploadOptions,
                message.data.clientOptions,
                {
                    jobsAdding: () => {
                        uploadManager.persistJobs();
                    },
                }
            );
            // TODO: .then send all jobs added
            break;
        }
        case UploadAction.UpdateUiData: {
            process.send?.({
                action: UploadAction.UpdateUiData,
                data: uploadManager.getJobsUiDataByPage(
                    message.data.pageNum,
                    message.data.count,
                    message.data.query,
                ),
            });
            break;
        }
        case UploadAction.StopJob: {
            uploadManager.stopJob(message.data.jobId);
            break;
        }
        case UploadAction.WaitJob: {
            uploadManager.waitJob(message.data.jobId);
            break;
        }
        case UploadAction.StartJob: {
            uploadManager.startJob(message.data.jobId, message.data.forceOverwrite);
            break;
        }
        case UploadAction.RemoveJob: {
            uploadManager.removeJob(message.data.jobId);
            uploadManager.persistJobs();
            break;
        }
        case UploadAction.CleanupJobs: {
            uploadManager.cleanupJobs();
            break;
        }
        case UploadAction.StartAllJobs: {
            uploadManager.startAllJobs();
            break;
        }
        case UploadAction.StopAllJobs: {
            uploadManager.stopAllJobs();
            break;
        }
        case UploadAction.RemoveAllJobs: {
            uploadManager.removeAllJobs();
            uploadManager.persistJobs();
            break;
        }
        default: {
            console.warn("Upload Manager received unknown action, message:", message);
        }
    }
});

process.on("exit", () => {
    uploadManager.persistJobs(true);
});

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
