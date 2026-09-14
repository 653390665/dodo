import React from 'react';

interface CompletionAutoGateInput {
  /** 事实面板存在且完成门尚未评估（undefined/'drafting'）时为 true。 */
  needsGate: boolean;
  inFlight: boolean;
  /** 自动补跑的身份键（章节 + 候选 run）；null 表示无可补跑对象。 */
  attemptKey: string | null;
  onComplete: () => void;
}

/**
 * Plan 207：事实面板出现且完成门未评估时，自动补跑一次完成审阅。
 * 约束：同一 attemptKey 至多触发一次——即使后续 GET 刷新把乐观写入的
 * 已评估门冲回未评估态，也不再自动补跑（完成风暴回归防线）；
 * 换章节或换候选 run 后重新获得一次。
 */
export function useCompletionAutoGate({
  needsGate,
  inFlight,
  attemptKey,
  onComplete,
}: CompletionAutoGateInput): void {
  const attemptedKeyRef = React.useRef<string | null>(null);
  const onCompleteRef = React.useRef(onComplete);
  React.useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  React.useEffect(() => {
    if (!needsGate || inFlight || !attemptKey) return;
    if (attemptedKeyRef.current === attemptKey) return;
    // onComplete 内部会同步置位在飞标记；defer 避免 effect 体内直接 setState。
    const timer = window.setTimeout(() => {
      attemptedKeyRef.current = attemptKey;
      onCompleteRef.current();
    }, 0);
    return () => window.clearTimeout(timer);
    // attemptKey（章节+候选 run）按候选稳定，进依赖保证换候选能重新武装；
    // 回调身份逐渲染变化，经 ref 读取以免反复清掉定时器饿死自动补跑。
  }, [needsGate, inFlight, attemptKey]);
}
