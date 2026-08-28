import { beforeEach, describe, expect, test } from 'vitest';

import {
  getAuthorFacingCapabilityActionLabel,
  getAuthorFacingCapabilityScopeLabel,
} from '../lib/capability-stage-cards';
import { useNovelStore } from '../stores/novel-store';
import type { CapabilityManifestEntry } from '../../shared/types/capability-manifest';

describe('independent capability launch state', () => {
  beforeEach(() => {
    useNovelStore.setState({
      continuationLaunchState: null,
      capabilityLaunchState: null,
    });
  });

  test('does not encode an overlay launch as continuation-pack state', () => {
    const launch = {
      novelId: 'novel-1',
      launchToken: 101,
      action: 'use-overlay' as const,
      assetId: 'overlay-1',
      targetChapterId: 'chapter-1',
    };

    useNovelStore.getState().setCapabilityLaunchState(launch);

    expect(useNovelStore.getState().capabilityLaunchState).toEqual(launch);
    expect(useNovelStore.getState().continuationLaunchState).toBeNull();
  });

  test('clears only the consumed launch token', () => {
    useNovelStore.getState().setCapabilityLaunchState({
      novelId: 'novel-1',
      launchToken: 101,
      action: 'run-utility',
      assetId: 'utility-1',
    });

    useNovelStore.getState().consumeCapabilityLaunch(100);
    expect(useNovelStore.getState().capabilityLaunchState?.launchToken).toBe(101);

    useNovelStore.getState().consumeCapabilityLaunch(101);
    expect(useNovelStore.getState().capabilityLaunchState).toBeNull();
  });

  test('stores a project technique launch independently', () => {
    const launch = {
      novelId: 'novel-1',
      launchToken: 102,
      action: 'use-project-technique' as const,
      assetId: 'opening-gold-three',
    };
    useNovelStore.getState().setCapabilityLaunchState(launch);
    expect(useNovelStore.getState().capabilityLaunchState).toEqual(launch);
    expect(useNovelStore.getState().continuationLaunchState).toBeNull();
  });

  test('maps capability scopes and actions to writer-facing labels', () => {
    const capability: Pick<CapabilityManifestEntry, 'action' | 'allowedScopes' | 'sideEffect'> = {
      action: 'add-to-stack',
      allowedScopes: ['project', 'chapter'],
      sideEffect: 'configuration',
    };

    expect(getAuthorFacingCapabilityScopeLabel('project')).toBe('作品默认');
    expect(getAuthorFacingCapabilityScopeLabel('chapter')).toBe('本章使用');
    expect(getAuthorFacingCapabilityScopeLabel('single-run')).toBe('仅运行一次');
    expect(getAuthorFacingCapabilityScopeLabel('system')).toBe('系统检查');
    expect(getAuthorFacingCapabilityActionLabel(capability, 'chapter')).toBe('用于本章');
    expect(getAuthorFacingCapabilityActionLabel(capability, 'project')).toBe('应用配置后设为作品默认');
    expect(getAuthorFacingCapabilityActionLabel(capability, 'system')).toBeUndefined();
    expect(getAuthorFacingCapabilityActionLabel({ action: 'run-diagnostic', allowedScopes: ['single-run'], sideEffect: 'none' })).toBe('运行审稿诊断');
    expect(getAuthorFacingCapabilityActionLabel({ action: 'use-technique', allowedScopes: ['chapter', 'single-run'], sideEffect: 'preview-only', output: 'transform-preview' }, 'chapter')).toBe('应用配置后写入本章规则');
    expect(getAuthorFacingCapabilityActionLabel({ action: 'use-technique', allowedScopes: ['chapter', 'single-run'], sideEffect: 'preview-only', output: 'transform-preview' }, 'single-run')).toBe('生成精修预览');
    expect(getAuthorFacingCapabilityActionLabel({ action: 'automatic', allowedScopes: ['system'], sideEffect: 'none' })).toBe('保存为系统检查候选');
  });
});
