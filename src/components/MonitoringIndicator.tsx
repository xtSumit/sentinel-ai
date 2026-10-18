import React, { useEffect, useState } from 'react';

export type MonitoringFlowStage = 'monitoring' | 'assessing' | 'verdict_ready' | 'running_agents' | 'complete' | 'monitored_only';

interface MonitoringIndicatorProps {
  isArmed?: boolean;
  isConnected?: boolean;
  simulationMode?: boolean;
  flowStage?: MonitoringFlowStage;
}

export function MonitoringIndicator({
  isArmed = true,
  isConnected = true,
  simulationMode = true,
  flowStage = 'monitoring'
}: MonitoringIndicatorProps) {
  if (!isArmed) return null;

  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(media.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  const isComplete = flowStage === 'complete';

  // Text mappings
  let title = 'Sentinel Agent — monitoring live';
  let subLine = 'Registry change feed · sanctions check on every change · no analyst trigger required';

  switch (flowStage) {
    case 'assessing':
      title = 'Sentinel Agent — assessing materiality';
      subLine = 'Re-resolving ownership and applying materiality rules';
      break;
    case 'verdict_ready':
      title = 'Sentinel Agent — verdict ready';
      subLine = 'Deterministic verdict drafted · awaiting analyst decision';
      break;
    case 'running_agents':
      title = 'Sentinel Agent — orchestrating KYC agents';
      subLine = 'Sanctions · PEP · adverse media · ownership integrity — running in parallel';
      break;
    case 'complete':
      title = 'Sentinel Agent — flow complete';
      subLine = 'Results mapped onto the tree · case created';
      break;
    case 'monitored_only':
      title = 'Sentinel Agent — monitoring';
      subLine = 'Change logged · the engine keeps watching';
      break;
    case 'monitoring':
    default:
      title = 'Sentinel Agent — monitoring live';
      subLine = 'Registry change feed · sanctions check on every change · no analyst trigger required';
      break;
  }

  if (simulationMode) {
    subLine += ' · simulated feed';
  }

  if (!isConnected) {
    title = 'Monitoring paused — reconnecting';
    subLine = 'Connection to Firestore real-time listener lost · attempting reconnection';
  }

  // Ring and color states
  const outerBorderColor = !isConnected ? 'var(--amber)' : isComplete ? 'var(--emerald)' : 'var(--primary)';
  const innerBorderColor = !isConnected ? 'var(--amber)' : isComplete ? 'var(--emerald)' : 'var(--coral)';
  const coreBg = !isConnected
    ? 'var(--amber)'
    : isComplete
      ? 'var(--emerald)'
      : 'linear-gradient(135deg, var(--primary), var(--coral))';

  return (
    <div
      className="flex items-center justify-between px-5 py-2 w-full select-none"
      style={{
        background: 'linear-gradient(90deg, var(--primary-s), var(--card) 55%)',
        borderBottom: '1px solid var(--line)'
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        {/* Orb (30px square, relative, three layers) */}
        <div className="relative w-[30px] h-[30px] flex-shrink-0">
          {/* Outer Ring */}
          <div
            className={`absolute inset-0 rounded-full border-[2.5px] border-transparent ${
              !prefersReducedMotion && isConnected && !isComplete ? 'animate-spin' : ''
            }`}
            style={{
              borderTopColor: outerBorderColor,
              animationDuration: '0.9s'
            }}
          />
          {/* Inner Ring */}
          <div
            className={`absolute inset-[5px] rounded-full border-[2.5px] border-transparent ${
              !prefersReducedMotion && isConnected && !isComplete ? 'animate-spin' : ''
            }`}
            style={{
              borderTopColor: innerBorderColor,
              animationDirection: 'reverse',
              animationDuration: '1.3s'
            }}
          />
          {/* Core */}
          <div
            className="absolute inset-[10px] rounded-full shadow-sm"
            style={{ background: coreBg }}
          />
        </div>

        {/* Text stack */}
        <div className="flex flex-col min-w-0">
          <span
            className="font-display text-[12px] font-bold truncate"
            style={{ color: 'var(--ink)' }}
          >
            {title}
          </span>
          <span
            className="font-mono text-[10.5px] truncate max-[900px]:hidden"
            style={{ color: 'var(--ink3)' }}
          >
            {subLine}
          </span>
        </div>
      </div>

      {/* Badge on the right */}
      {!isConnected ? (
        <span
          className="text-[9.5px] font-mono font-extrabold tracking-[0.6px] px-[11px] py-1 rounded-[14px] flex-shrink-0"
          style={{
            backgroundColor: 'var(--amber-s)',
            color: 'var(--amber)'
          }}
        >
          ● PAUSED
        </span>
      ) : isComplete ? (
        <span
          className="text-[9.5px] font-mono font-extrabold tracking-[0.6px] px-[11px] py-1 rounded-[14px] flex-shrink-0"
          style={{
            backgroundColor: 'var(--emerald-s)',
            color: 'var(--emerald)'
          }}
        >
          ✓ COMPLETE
        </span>
      ) : (
        <span
          className={`text-[9.5px] font-mono font-extrabold tracking-[0.6px] px-[11px] py-1 rounded-[14px] flex-shrink-0 ${
            !prefersReducedMotion ? 'animate-pulse' : ''
          }`}
          style={{
            backgroundColor: 'var(--primary-s)',
            color: 'var(--primary)'
          }}
        >
          ● LIVE
        </span>
      )}
    </div>
  );
}
