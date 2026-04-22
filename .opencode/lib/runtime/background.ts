export const BACKGROUND_TASK_STATUSES = [
  "submitted",
  "running",
  "settled",
  "timed-out",
  "cancelled",
] as const;

export type BackgroundTaskStatus = (typeof BACKGROUND_TASK_STATUSES)[number];

export interface BackgroundTask<TResult = unknown> {
  id: string;
  description: string;
  status: BackgroundTaskStatus;
  submittedAt: number;
  updatedAt: number;
  timeoutAt?: number;
  result?: TResult;
  cancellationReason?: string;
}

export class BackgroundCoordinator<TResult = unknown> {
  private readonly tasks = new Map<string, BackgroundTask<TResult>>();

  public constructor(private readonly now: () => number = () => Date.now()) {}

  public submit(input: {
    id: string;
    description: string;
    timeoutMs?: number;
  }): BackgroundTask<TResult> {
    const submittedAt = this.now();
    const task: BackgroundTask<TResult> = {
      id: input.id,
      description: input.description,
      status: "submitted",
      submittedAt,
      updatedAt: submittedAt,
      ...(input.timeoutMs === undefined
        ? {}
        : { timeoutAt: submittedAt + input.timeoutMs }),
    };

    this.tasks.set(task.id, task);
    return task;
  }

  public markRunning(taskId: string): BackgroundTask<TResult> {
    const task = this.getOrThrow(taskId);
    const nextTask: BackgroundTask<TResult> = {
      ...task,
      status: "running",
      updatedAt: this.now(),
    };

    this.tasks.set(taskId, nextTask);
    return nextTask;
  }

  public settle(taskId: string, result: TResult): BackgroundTask<TResult> {
    const task = this.getOrThrow(taskId);
    const nextTask: BackgroundTask<TResult> = {
      ...task,
      status: "settled",
      result,
      updatedAt: this.now(),
    };

    this.tasks.set(taskId, nextTask);
    return nextTask;
  }

  public cancel(taskId: string, reason = "cancelled explicitly"): BackgroundTask<TResult> {
    const task = this.getOrThrow(taskId);
    const nextTask: BackgroundTask<TResult> = {
      ...task,
      status: "cancelled",
      cancellationReason: reason,
      updatedAt: this.now(),
    };

    this.tasks.set(taskId, nextTask);
    return nextTask;
  }

  public sweepTimeouts(now = this.now()): BackgroundTask<TResult>[] {
    const timedOut: BackgroundTask<TResult>[] = [];

    for (const [taskId, task] of this.tasks.entries()) {
      if (
        task.timeoutAt !== undefined &&
        now >= task.timeoutAt &&
        (task.status === "submitted" || task.status === "running")
      ) {
        const nextTask: BackgroundTask<TResult> = {
          ...task,
          status: "timed-out",
          updatedAt: now,
        };

        this.tasks.set(taskId, nextTask);
        timedOut.push(nextTask);
      }
    }

    return timedOut;
  }

  public get(taskId: string): BackgroundTask<TResult> | undefined {
    return this.tasks.get(taskId);
  }

  public list(): BackgroundTask<TResult>[] {
    return [...this.tasks.values()].sort((left, right) => left.submittedAt - right.submittedAt);
  }

  private getOrThrow(taskId: string): BackgroundTask<TResult> {
    const task = this.tasks.get(taskId);

    if (!task) {
      throw new Error(`Unknown background task: ${taskId}`);
    }

    return task;
  }
}
