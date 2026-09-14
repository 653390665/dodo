import { getDeckDimensionSummary } from '../../lib/skills-studio-governance';
import { useSkillsCandidateStore } from '../../stores/skills-candidate-store';
import { useSkillsConfigurationStore } from '../../stores/skills-configuration-store';

/** 候选卡解析结果（视图 resolveDeckCard 的返回口径，供 props 传递）。 */
export interface DeckCardSummary {
  id: string;
  title: string;
  source: string;
  version: string | number;
  cardType: string;
  dimensions: string[];
  known: boolean;
}

interface CandidateTrayProps {
  projectDeckIds: string[];
  resolveDeckCard: (id: string) => DeckCardSummary;
  /** 确认替换目标卡（原弹窗 onClick 内联编排，收口为视图回调）。 */
  onReplaceDeckCard: (targetId: string) => void;
  onCancel: () => void;
}

/**
 * 卡组已满候选托盘（Plan 195 切片 C Step 3 自 SkillsStudioView 内联迁出）。
 * 候选簇与会话过期态自订阅 candidate/configuration store；替换编排留在视图。
 */
export function CandidateTray({
  projectDeckIds,
  resolveDeckCard,
  onReplaceDeckCard,
  onCancel,
}: CandidateTrayProps) {
  const pendingCandidateId = useSkillsCandidateStore((state) => state.pendingCandidateId);
  const staleConfigurationSession = useSkillsConfigurationStore(
    (state) => state.staleConfigurationSession
  );
  if (!pendingCandidateId) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-xl border border-theme-border bg-theme-sidebar p-5 shadow-xl">
        <h2 className="text-base font-bold text-theme-text">作品卡组已满</h2>
        <p className="mt-2 text-xs text-theme-muted">
          请选择要替换的卡片，或取消本次候选配置。
        </p>
        {(() => {
          const candidate = resolveDeckCard(pendingCandidateId);
          return (
            <div className="mt-4 rounded-lg border border-theme-accent/30 bg-theme-accent/5 p-3 text-xs">
              <div className="font-bold text-theme-text">待放入：{candidate.title}</div>
              <div className="mt-1 text-[10px] text-theme-muted">
                来源：{candidate.source} · 版本：{candidate.version} · 卡型：
                {candidate.cardType}
              </div>
              <div className="mt-1 text-[10px] text-theme-muted">
                负责维度：{getDeckDimensionSummary(candidate.dimensions)}
              </div>
            </div>
          );
        })()}
        <div className="mt-4 space-y-2">
          {projectDeckIds.map((id, index) => {
            const target = resolveDeckCard(id);
            const candidate = resolveDeckCard(pendingCandidateId);
            const conflictDimensions = candidate.dimensions.filter((dimension) =>
              target.dimensions.includes(dimension)
            );
            const lostDimensions = target.dimensions.filter(
              (dimension) => !candidate.dimensions.includes(dimension)
            );
            const newDimensions = candidate.dimensions.filter(
              (dimension) => !target.dimensions.includes(dimension)
            );
            const impactRows = [
              {
                label: '重叠',
                value: conflictDimensions.length
                  ? getDeckDimensionSummary(conflictDimensions)
                  : '无',
              },
              {
                label: '会失去',
                value: lostDimensions.length ? getDeckDimensionSummary(lostDimensions) : '无',
              },
              {
                label: '会新增',
                value: newDimensions.length ? getDeckDimensionSummary(newDimensions) : '无',
              },
            ];
            return (
              <button
                key={id}
                type="button"
                disabled={staleConfigurationSession || !target.known || !candidate.known}
                className="w-full rounded-lg border border-theme-border px-3 py-2 text-left text-xs enabled:hover:border-theme-accent disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => onReplaceDeckCard(id)}
              >
                <span className="block font-bold">
                  {target.title} · {index === 0 ? '主卡' : `辅卡 ${index}`}
                </span>
                <span className="mt-1 block text-[10px] text-theme-muted">
                  来源：{target.source} · 版本：{target.version} · 卡型：{target.cardType}
                </span>
                <span className="mt-1 block text-[10px] text-theme-muted">
                  负责维度：{getDeckDimensionSummary(target.dimensions)}
                </span>
                {target.known && candidate.known ? (
                  <span className="mt-2 grid grid-cols-3 gap-1 text-[10px] text-theme-muted">
                    {impactRows.map((row) => (
                      <span
                        key={row.label}
                        className="rounded border border-theme-border/40 bg-theme-bg/40 px-1.5 py-1"
                      >
                        <span className="block font-bold text-theme-text">{row.label}</span>
                        <span className="mt-0.5 block">{row.value}</span>
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="mt-1 block text-[10px] text-theme-muted">
                    来源、版本或运行时状态未知，暂不能确认替换。
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="mt-4 w-full rounded-lg border border-theme-border px-3 py-2 text-xs text-theme-muted"
          onClick={onCancel}
        >
          取消
        </button>
      </div>
    </div>
  );
}
