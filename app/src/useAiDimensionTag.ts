"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "./api";

export type AiDimensionUpdate = {
  dimensionId: string;
  value: number;
  lastRev: number;
};

export type AiDimensionEvent = {
  seq: number;
  type: "applied";
  assetId: string;
  updates: AiDimensionUpdate[];
  revision: number;
};

export type AiDimensionJob = {
  id: string;
  status: "running" | "stopping" | "stopped" | "done" | "error";
  total: number;
  done: number;
  applied: number;
  skipped: number;
  failed: number;
  timedOut: number;
  inFlight: string[];
  canStop: boolean;
  items?: Array<{ assetId: string; status: string; error?: string }>;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

export type AiDimensionTagState = "idle" | "running" | "stopping" | "done" | "error";

const POLL_MS = 800;
const HIDDEN_POLL_MS = 1_500;
const IDLE_POLL_MS = 5_000;

function summaryText(job: AiDimensionJob) {
  const parts = [`已标记 ${job.applied} 张图片`];
  if (job.skipped) parts.push(`跳过 ${job.skipped} 张`);
  if (job.timedOut) parts.push(`${job.timedOut} 张超时`);
  if (job.failed) parts.push(`${job.failed} 张失败`);
  return parts.join("，");
}

/**
 * 批量 AI 维度任务：创建、轮询、应用增量、停止、刷新/切页后 adopt。
 * 单图入口不使用这个 hook（它是同步请求）。
 */
export function useAiDimensionTag(params: {
  projectId: string;
  pageId: string;
  enabled: boolean;
  flush: () => Promise<void>;
  hasPending: () => boolean;
  onApplied: (assetId: string, updates: AiDimensionUpdate[], revision: number) => void;
  onMessage: (message: string) => void;
}) {
  const [job, setJob] = useState<AiDimensionJob | null>(null);
  const [status, setStatus] = useState<AiDimensionTagState>("idle");
  const [session, setSession] = useState(0);
  const handlersRef = useRef(params);
  handlersRef.current = params;
  const pageKeyRef = useRef("");
  const startedKeyRef = useRef("");

  const start = useCallback(async ({ dimensionIds, mode }: { dimensionIds: string[]; mode: "all" | "zero" }) => {
    const current = handlersRef.current;
    if (!current.enabled || !current.projectId || !current.pageId) return;
    try {
      await current.flush();
      if (current.hasPending()) {
        current.onMessage("坐标正在保存，请稍后再试");
        return;
      }
      const data = await apiFetch<{ jobId: string; total: number }>("/api/preview-pages/ai-dimensions", {
        method: "POST",
        body: JSON.stringify({
          projectId: current.projectId,
          pageId: current.pageId,
          dimensionIds,
          mode,
        }),
      });
      setJob({
        id: data.jobId,
        status: "running",
        total: data.total,
        done: 0,
        applied: 0,
        skipped: 0,
        failed: 0,
        timedOut: 0,
        inFlight: [],
        canStop: true,
      });
      setStatus("running");
      startedKeyRef.current = `${current.projectId}:${current.pageId}:${current.enabled}`;
      setSession((value) => value + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      current.onMessage(`AI 标注失败：${message}`);
      setStatus("idle");
    }
  }, []);

  const stop = useCallback(async () => {
    const currentJob = job;
    if (!currentJob || !currentJob.canStop || currentJob.status === "stopped" || currentJob.status === "done" || currentJob.status === "error") return;
    setStatus("stopping");
    try {
      await apiFetch("/api/preview-pages/ai-dimensions/stop", {
        method: "POST",
        body: JSON.stringify({ jobId: currentJob.id }),
      });
    } catch (error) {
      handlersRef.current.onMessage(`停止失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }, [job]);

  useEffect(() => {
    const current = handlersRef.current;
    const pageKey = `${current.projectId}:${current.pageId}:${current.enabled}`;
    if (!current.enabled || !current.projectId || !current.pageId) {
      pageKeyRef.current = pageKey;
      setJob(null);
      setStatus("idle");
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    let inFlight = false;
    let seq = 0;
    let sawRunning = false;
    let announced = false;
    let observedJobId = "";
    let terminal = false;

    if (pageKeyRef.current !== pageKey) {
      pageKeyRef.current = pageKey;
      setJob(null);
      setStatus("idle");
    }

    const schedule = (delay: number) => {
      if (cancelled || terminal) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => { void poll(); }, delay);
    };

    const poll = async (): Promise<void> => {
      if (cancelled || terminal) return;
      if (document.visibilityState !== "visible") {
        schedule(HIDDEN_POLL_MS);
        return;
      }
      if (inFlight) return;
      inFlight = true;
      let next = true;
      try {
        const data = await apiFetch<{ job: AiDimensionJob | null; events: AiDimensionEvent[] }>(
          `/api/preview-pages/ai-dimensions/job?projectId=${encodeURIComponent(current.projectId)}&pageId=${encodeURIComponent(current.pageId)}&since=${seq}`,
        );
        if (cancelled) return;
        if (!data.job) {
          if (sawRunning) {
            handlersRef.current.onMessage("AI 标注任务已中断，已应用的维度保留");
            sawRunning = false;
          }
          setJob(null);
          setStatus("idle");
          // 同一 Page 的其他用户可能稍后启动任务；保持低频发现，避免页面停留时永远看不到。
          schedule(IDLE_POLL_MS);
          return;
        }
        setJob(data.job);
        if (observedJobId !== data.job.id) {
          observedJobId = data.job.id;
          announced = false;
          sawRunning = startedKeyRef.current === pageKey
            || data.job.status === "running"
            || data.job.status === "stopping";
        }
        for (const event of data.events ?? []) {
          if (event.seq <= seq) continue;
          seq = event.seq;
          handlersRef.current.onApplied(event.assetId, event.updates, event.revision);
        }
        if (data.job.status === "done" || data.job.status === "stopped" || data.job.status === "error") {
          next = false;
          if (data.job.status === "error") {
            setStatus("error");
            handlersRef.current.onMessage(`AI 标注失败：${data.job.error || "未知错误"}`);
          } else if (data.job.status === "stopped") {
            setStatus("done");
            if (sawRunning && !announced) handlersRef.current.onMessage(`已停止 AI 标注；${summaryText(data.job)}`);
          } else {
            setStatus("done");
            if (sawRunning && !announced) handlersRef.current.onMessage(`AI 标注完成：${summaryText(data.job)}`);
          }
          announced = true;
          // 任务结束后保持低频发现：同一 Page 的其他用户可能启动新的批量任务。
          schedule(IDLE_POLL_MS);
          return;
        }
        sawRunning = true;
        setStatus(data.job.status === "stopping" ? "stopping" : "running");
        schedule(POLL_MS);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          terminal = true;
          next = false;
          setStatus("error");
          setJob(null);
          handlersRef.current.onMessage("AI 标注任务已中断，已应用的维度保留");
          return;
        }
        schedule(HIDDEN_POLL_MS);
      } finally {
        inFlight = false;
        if (next && !cancelled && !terminal) {
          // 上面的 schedule 已经排过；这里只在异常路径兜底，避免出现两个定时器。
          if (timer === undefined) schedule(POLL_MS);
        }
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !inFlight && !terminal) {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        void poll();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    void poll();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [params.projectId, params.pageId, params.enabled, session]);

  return {
    job,
    status,
    active: status === "running" || status === "stopping",
    inFlight: job?.inFlight ?? [],
    canStop: Boolean(job?.canStop),
    start,
    stop,
  };
}
