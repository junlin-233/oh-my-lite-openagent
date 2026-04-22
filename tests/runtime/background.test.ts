import { BackgroundCoordinator } from "../../.opencode/lib/runtime/background.js";

describe("bounded background coordination", () => {
  it("submits, lists, settles, and cancels enumerable tasks", () => {
    let now = 10;
    const coordinator = new BackgroundCoordinator(() => now);

    coordinator.submit({ id: "task-1", description: "first task", timeoutMs: 100 });
    now = 20;
    coordinator.submit({ id: "task-2", description: "second task" });
    coordinator.markRunning("task-1");
    coordinator.settle("task-1", { ok: true });
    coordinator.cancel("task-2", "cancelled by user");

    expect(coordinator.list()).toEqual([
      {
        id: "task-1",
        description: "first task",
        status: "settled",
        submittedAt: 10,
        updatedAt: 20,
        timeoutAt: 110,
        result: { ok: true },
      },
      {
        id: "task-2",
        description: "second task",
        status: "cancelled",
        submittedAt: 20,
        updatedAt: 20,
        cancellationReason: "cancelled by user",
      },
    ]);
  });

  it("times out running work without creating hidden workers", () => {
    let now = 0;
    const coordinator = new BackgroundCoordinator(() => now);

    coordinator.submit({ id: "task-1", description: "timed task", timeoutMs: 50 });
    coordinator.markRunning("task-1");

    now = 100;
    const timedOut = coordinator.sweepTimeouts();

    expect(timedOut).toHaveLength(1);
    expect(timedOut[0]?.status).toBe("timed-out");
    expect(coordinator.get("task-1")?.status).toBe("timed-out");
  });
});
