/**
 * Sentinel AI — Application Shell
 * Fixed 56px topbar, 44px flow strip, 62px icon rail per DESIGN.md
 * Integrates Firebase user authentication avatar dropdown, role display, sign-out, and supervisor governance toggle.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  ShieldAlert,
  Network,
  Bell,
  Briefcase,
  ChevronRight,
  Check,
  LogOut,
  User,
  Shield,
  HelpCircle,
  ExternalLink
} from 'lucide-react';
import { SENTINEL_MARK_64 } from '../brand-assets';
import { useAuth } from '../context/AuthContext';

interface AppShellProps {
  activeStep: number; // 1..7
  activeRailItem: string;
  onSelectRailItem: (id: string) => void;
  pendingAlertsCount?: number;
  children: React.ReactNode;
}

interface FlowStep {
  num: number;
  label: string;
}

const FLOW_STEPS: FlowStep[] = [
  { num: 1, label: 'KYC Initiation' },
  { num: 2, label: 'Autonomous Mapping' },
  { num: 3, label: 'Ownership Tree' },
  { num: 4, label: 'Live Monitoring' },
  { num: 5, label: 'Materiality' },
  { num: 6, label: 'KYC Agents' },
  { num: 7, label: 'Unified Results' },
];

export const AppShell: React.FC<AppShellProps> = ({
  activeStep,
  activeRailItem,
  onSelectRailItem,
  pendingAlertsCount = 0,
  children
}) => {
  const { user, profile, signOut, setGovernanceMode, isSupervisor } = useAuth();
  const [hoveredRail, setHoveredRail] = useState<string | null>(null);
  const [showGovTooltip, setShowGovTooltip] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const avatarMenuRef = useRef<HTMLDivElement>(null);

  // Close avatar menu on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (avatarMenuRef.current && !avatarMenuRef.current.contains(event.target as Node)) {
        setShowAvatarMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const govMode = profile?.governanceMode || 'human-in-the-loop';

  const handleGovToggle = async (mode: 'human-in-the-loop' | 'automated') => {
    if (mode === govMode) return;
    if (mode === 'automated' && !isSupervisor) {
      setShowGovTooltip(true);
      setTimeout(() => setShowGovTooltip(false), 3000);
      return;
    }
    await setGovernanceMode(mode);
  };

  const RAIL_ITEMS = [
    { id: 'kyc-initiation', label: 'KYC Initiation', icon: ShieldAlert, enabled: true },
    { id: 'beneficial-ownership', label: 'Beneficial Ownership', icon: Network, enabled: true },
    { id: 'alerts', label: 'Alerts', icon: Bell, enabled: true, badgeCount: pendingAlertsCount },
    { id: 'cases', label: 'Cases (Phase 4)', icon: Briefcase, enabled: false },
  ];

  const userInitials = profile?.displayName
    ? profile.displayName
        .split(' ')
        .map((p) => p[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'CA';

  return (
    <div
      className="h-screen w-screen overflow-hidden flex flex-col select-none"
      style={{ backgroundColor: 'var(--bg)' }}
    >
      {/* TOPBAR — fixed 56px tall, white/card, bottom border --line */}
      <header
        className="h-[56px] shrink-0 w-full flex items-center justify-between px-4 z-30"
        style={{
          backgroundColor: 'var(--card)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        {/* Left: Sentinel shield logo + wordmark + sub-label */}
        <div className="flex items-center gap-3">
          <img
            src={SENTINEL_MARK_64}
            alt="Sentinel AI"
            className="h-[30px] w-auto object-contain block"
          />

          <div className="flex flex-col">
            <div className="flex items-baseline leading-none">
              <span
                className="font-display font-extrabold tracking-tight"
                style={{ fontSize: '16.5px', color: 'var(--ink)' }}
              >
                Sentinel
              </span>
              <span
                className="font-display font-extrabold tracking-tight ml-1"
                style={{ fontSize: '16.5px', color: 'var(--primary)' }}
              >
                AI
              </span>
            </div>
            <span
              className="uppercase font-bold tracking-[0.7px] mt-0.5 leading-none"
              style={{ fontSize: '9px', color: 'var(--ink3)' }}
            >
              OWNERSHIP · PERPETUAL KYC
            </span>
          </div>
        </div>

        {/* Right: Mode pill, Governance toggle, Topbar Avatar Dropdown */}
        <div className="flex items-center gap-3">
          {/* Mode Pill */}
          <div
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium"
            style={{
              backgroundColor: 'var(--bg2)',
              borderRadius: '20px',
              border: '1px solid var(--line)',
              color: 'var(--ink2)',
            }}
          >
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: 'var(--amber)' }}
            />
            <span>Preview · simulated feeds</span>
          </div>

          {/* Governance Toggle */}
          <div
            className="relative"
            onMouseEnter={() => !isSupervisor && setShowGovTooltip(true)}
            onMouseLeave={() => setShowGovTooltip(false)}
          >
            <div
              className="flex items-center p-0.5 rounded-full"
              style={{
                backgroundColor: 'var(--bg2)',
                border: '1px solid var(--line)',
              }}
            >
              <button
                type="button"
                onClick={() => handleGovToggle('human-in-the-loop')}
                className="px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer"
                style={{
                  backgroundColor: govMode === 'human-in-the-loop' ? 'var(--primary)' : 'transparent',
                  color: govMode === 'human-in-the-loop' ? '#ffffff' : 'var(--ink2)',
                  boxShadow:
                    govMode === 'human-in-the-loop'
                      ? '0 2px 8px rgba(1, 110, 253, 0.28)'
                      : 'none',
                }}
              >
                Human-in-the-loop
              </button>
              <button
                type="button"
                onClick={() => handleGovToggle('automated')}
                className="px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer"
                style={{
                  backgroundColor: govMode === 'automated' ? 'var(--emerald)' : 'transparent',
                  color: govMode === 'automated' ? '#ffffff' : isSupervisor ? 'var(--ink2)' : 'var(--ink3)',
                  cursor: isSupervisor ? 'pointer' : 'not-allowed',
                  boxShadow:
                    govMode === 'automated'
                      ? '0 2px 8px rgba(16, 185, 129, 0.28)'
                      : 'none',
                }}
              >
                Automated
              </button>
            </div>

            {/* Tooltip for non-supervisors */}
            {showGovTooltip && !isSupervisor && (
              <div
                className="absolute right-0 top-full mt-2 px-3 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap z-50 pointer-events-none flex items-center gap-1.5 shadow-xl animate-fade-in"
                style={{
                  backgroundColor: 'var(--ink)',
                  color: '#ffffff',
                }}
              >
                <Shield className="w-3 h-3 text-amber-400" />
                <span>Automated mode requires Supervisor role</span>
              </div>
            )}
          </div>

          {/* Topbar Avatar with Dropdown */}
          <div className="relative" ref={avatarMenuRef}>
            <button
              type="button"
              onClick={() => setShowAvatarMenu(!showAvatarMenu)}
              className="w-8 h-8 rounded-full sig-gradient-bg flex items-center justify-center text-white text-xs font-bold font-display shadow-sm cursor-pointer transition-transform hover:scale-105 active:scale-95"
              aria-label="User profile and session menu"
            >
              {userInitials}
            </button>

            {/* Dropdown Menu */}
            {showAvatarMenu && (
              <div
                className="absolute right-0 top-full mt-2 w-64 rounded-2xl p-4 shadow-2xl border z-50 animate-scale-up"
                style={{
                  backgroundColor: 'var(--card)',
                  borderColor: 'var(--line)',
                  boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.5)'
                }}
              >
                <div className="flex items-center gap-3 pb-3 border-b" style={{ borderColor: 'var(--line)' }}>
                  <div className="w-10 h-10 rounded-full sig-gradient-bg flex items-center justify-center text-white text-sm font-bold font-display shadow">
                    {userInitials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate" style={{ color: 'var(--ink)' }}>
                      {profile?.displayName || 'Compliance Analyst'}
                    </p>
                    <p className="text-[11px] font-mono truncate" style={{ color: 'var(--ink3)' }}>
                      {profile?.email || user?.email || 'analyst@sentinel.internal'}
                    </p>
                  </div>
                </div>

                <div className="py-3 space-y-2 border-b" style={{ borderColor: 'var(--line)' }}>
                  <div className="flex items-center justify-between text-xs">
                    <span style={{ color: 'var(--ink3)' }}>Assigned Role:</span>
                    <span
                      className="font-mono font-bold uppercase text-[10px] px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: isSupervisor ? 'rgba(245, 158, 11, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                        color: isSupervisor ? 'var(--amber)' : 'var(--primary)'
                      }}
                    >
                      {profile?.role || 'analyst'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span style={{ color: 'var(--ink3)' }}>Governance:</span>
                    <span className="font-mono text-[10px]" style={{ color: 'var(--ink2)' }}>
                      {govMode === 'automated' ? 'Automated' : 'Human-in-the-loop'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span style={{ color: 'var(--ink3)' }}>Security Model:</span>
                    <span className="font-mono text-[10px] text-emerald-500 font-semibold">
                      Firebase ABAC
                    </span>
                  </div>
                </div>

                <div className="pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAvatarMenu(false);
                      signOut();
                    }}
                    className="w-full py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* FLOW STRIP — fixed under topbar, 44px, background --bg2, bottom border */}
      <div
        className="h-[44px] shrink-0 w-full flex items-center justify-center px-4 z-20 overflow-x-auto"
        style={{
          backgroundColor: 'var(--bg2)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div className="flex items-center gap-1.5">
          {FLOW_STEPS.map((step, idx) => {
            const isDone = step.num < activeStep;
            const isActive = step.num === activeStep;

            return (
              <React.Fragment key={step.num}>
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap"
                  style={{
                    backgroundColor: isActive ? 'var(--primary-s)' : 'transparent',
                    color: isActive
                      ? 'var(--primary)'
                      : isDone
                      ? 'var(--emerald)'
                      : 'var(--ink3)',
                  }}
                >
                  <span
                    className="w-[17px] h-[17px] rounded-full flex items-center justify-center text-[10px] font-mono-code font-bold shrink-0"
                    style={{
                      backgroundColor: isActive
                        ? 'var(--primary)'
                        : isDone
                        ? 'var(--emerald)'
                        : 'transparent',
                      color: isActive || isDone ? '#ffffff' : 'var(--ink3)',
                      border:
                        isActive || isDone ? 'none' : '1.5px solid var(--line)',
                    }}
                  >
                    {isDone ? <Check className="w-2.5 h-2.5 stroke-[3]" /> : step.num}
                  </span>
                  <span className={isActive ? 'font-semibold' : ''}>{step.label}</span>
                </div>

                {idx < FLOW_STEPS.length - 1 && (
                  <ChevronRight
                    className="w-3.5 h-3.5 shrink-0"
                    style={{ color: 'var(--ink3)', opacity: 0.6 }}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* BODY: ICON RAIL + MAIN AREA */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* ICON RAIL — fixed left, 62px wide, white, right border */}
        <aside
          className="w-[62px] shrink-0 h-full flex flex-col items-center py-3 gap-2 z-20"
          style={{
            backgroundColor: 'var(--card)',
            borderRight: '1px solid var(--line)',
          }}
          aria-label="Primary Feature Navigation"
        >
          {RAIL_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeRailItem;
            const isHovered = hoveredRail === item.id;

            return (
              <div
                key={item.id}
                className="relative w-full flex justify-center"
                onMouseEnter={() => setHoveredRail(item.id)}
                onMouseLeave={() => setHoveredRail(null)}
              >
                {/* 3px primary blue bar on the rail's left edge when active */}
                {isActive && (
                  <span
                    className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r"
                    style={{ backgroundColor: 'var(--primary)' }}
                  />
                )}

                <button
                  type="button"
                  onClick={() => item.enabled && onSelectRailItem(item.id)}
                  disabled={!item.enabled}
                  className="w-[44px] h-[44px] rounded-[12px] flex items-center justify-center transition-all relative"
                  style={{
                    backgroundColor: isActive
                      ? 'var(--primary-s)'
                      : isHovered && item.enabled
                      ? 'var(--bg2)'
                      : 'transparent',
                    color: isActive
                      ? 'var(--primary)'
                      : item.enabled
                      ? 'var(--ink2)'
                      : 'var(--ink3)',
                    opacity: item.enabled ? 1 : 0.45,
                    cursor: item.enabled ? 'pointer' : 'not-allowed',
                  }}
                  aria-label={item.label}
                >
                  <Icon className="w-5 h-5" />
                  {item.badgeCount !== undefined && item.badgeCount > 0 && (
                    <span
                      className="absolute top-1.5 right-1.5 px-1 min-w-[15px] h-[15px] rounded-full text-[9px] font-mono-code font-bold flex items-center justify-center text-white"
                      style={{ backgroundColor: 'var(--coral)' }}
                    >
                      {item.badgeCount}
                    </span>
                  )}
                </button>

                {/* Hover tooltip: dark ink pill to the right */}
                {isHovered && (
                  <div
                    className="absolute left-[68px] top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap z-50 pointer-events-none flex items-center gap-1.5"
                    style={{
                      backgroundColor: 'var(--ink)',
                      color: '#ffffff',
                      boxShadow: 'var(--sh2)',
                    }}
                  >
                    <span>{item.label}</span>
                    {!item.enabled && (
                      <span
                        className="text-[10px] font-mono-code opacity-75 pl-1 border-l"
                        style={{ borderColor: 'rgba(255,255,255,0.2)' }}
                      >
                        Coming soon
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        {/* MAIN AREA */}
        <main className="flex-1 h-full min-w-0 overflow-y-auto relative p-6">
          {children}
        </main>
      </div>
    </div>
  );
};
