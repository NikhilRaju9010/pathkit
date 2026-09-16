import { proxyActivities, sleep } from '@temporalio/workflow';
import type * as activities from './report-activities';

const { startReportJob, checkReportJobStatus, downloadReportResult } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
});

export interface GenerateReportInput {
  reportId: string;
  maxPollAttempts: number;
}

export async function reportPollingWorkflow(input: GenerateReportInput): Promise<string> {
  await startReportJob(input.reportId);

  for (let attempt = 1; attempt <= input.maxPollAttempts; attempt++) {
    const status = await checkReportJobStatus(input.reportId);

    if (status === 'complete') {
      return downloadReportResult(input.reportId);
    }

    if (status === 'failed') {
      return 'report generation failed';
    }

    await sleep('10 seconds');
  }

  return 'report generation timed out';
}
