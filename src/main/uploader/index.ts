import {
    AddedJobsReplyMessage,
    JobCompletedReplyMessage,
    UpdateUiDataReplyMessage,
    UploadAction,
    UploadMessage
} from "@common/ipc-actions/upload";
import UploadManager from "./upload-manager";
import {UploadJob} from "@common/models/job";
import {Status} from "@common/models/job/types";

// initial UploadManager Config from argv after `--config-json`
const configStr = process.argv.find((_arg, i, arr) => arr[i - 1] === "--config-json");
const uploadManagerConfig = configStr ? JSON.parse(configStr) : {};
uploadManagerConfig.onJobDone = handleJobDone;
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
                    jobsAdded: () => {
                        const replyMessage: AddedJobsReplyMessage = {
                            action: UploadAction.AddedJobs,
                            data: {
                                filePathnameList: message.data.filePathnameList,
                                destInfo: message.data.destInfo,
                            },
                        }
                        process.send?.(replyMessage);
                    }
                }
            );
            break;
        }
        case UploadAction.UpdateUiData: {
            const replyMessage: UpdateUiDataReplyMessage = {
                action: UploadAction.UpdateUiData,
                data: uploadManager.getJobsUiDataByPage(
                    message.data.pageNum,
                    message.data.count,
                    message.data.query,
                ),
            }
            process.send?.(replyMessage);
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

function handleJobDone(jobId: string, job?: UploadJob) {
    if (job?.status === Status.Finished) {
        const jobCompletedReplayMessage: JobCompletedReplyMessage = {
            action: UploadAction.JobCompleted,
            data: {
                jobId,
                jobUiData: job.uiData,
            }
        }
        process.send?.(jobCompletedReplayMessage);
    }
}

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
