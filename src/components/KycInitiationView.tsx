/**
 * Sentinel AI — KYC Initiation & Autonomous Mapping View
 * Flow Steps 1 & 2 per custom specification:
 * - Entity intake with name, jurisdiction select, optional existing customer ID
 * - "Try a sample" prefill chips for the 5 BODS groups
 * - Deterministic matching against the five mapped corporate groups
 * - Automatic customer persistence to Firestore customers/{customerId}
 * - Autonomous Mapping agent run card with real metrics and animated step execution
 */

import React, { useState, useEffect } from 'react';
import { bodsRepository } from '../data/repository';
import { resolveBeneficialOwnership } from '../engine/uboEngine';
import { useAuth } from '../context/AuthContext';
import { db, writeAuditRecord } from '../lib/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where
} from 'firebase/firestore';
import {
  Sparkles,
  Search,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Loader2,
  Building2,
  Globe2,
  Hash,
  Layers,
  Database,
  History,
  GitBranch,
  ShieldAlert
} from 'lucide-react';
import { normaliseEntityName } from '../adapters/sanctionsAdapter';

interface KycInitiationViewProps {
  onOpenCustomerWorkspace: (groupId: string, customerId: string) => void;
}

interface MappingStep {
  id: number;
  label: string;
  detail: string;
  status: 'waiting' | 'running' | 'completed';
}

export const KycInitiationView: React.FC<KycInitiationViewProps> = ({
  onOpenCustomerWorkspace
}) => {
  const { user, profile } = useAuth();
  const groups = bodsRepository.getGroups();
  const jurisdictionRules = bodsRepository.getJurisdictionRules();

  // Form State
  const [legalName, setLegalName] = useState('');
  const [jurisdiction, setJurisdiction] = useState('UK');
  const [customerIdInput, setCustomerIdInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Match Result State
  const [matchedGroup, setMatchedGroup] = useState<any | null>(null);
  const [resolvedCustomerId, setResolvedCustomerId] = useState<string | null>(null);
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [mappingActive, setMappingActive] = useState(false);
  const [mappingComplete, setMappingComplete] = useState(false);

  // Agent Steps State
  const [steps, setSteps] = useState<MappingStep[]>([
    { id: 1, label: 'Resolve customer profile', detail: 'Pending customer identification...', status: 'waiting' },
    { id: 2, label: 'Load registry records', detail: 'Waiting for intake...', status: 'waiting' },
    { id: 3, label: 'Apply change history', detail: 'Waiting for registry events...', status: 'waiting' },
    { id: 4, label: 'Resolve ownership', detail: 'Awaiting graph traversal...', status: 'waiting' },
    { id: 5, label: 'Flag data gaps', detail: 'Calculating completeness index...', status: 'waiting' }
  ]);

  const handlePrefill = (group: any) => {
    setLegalName(group.name);
    setJurisdiction(group.rootJurisdiction);
    setCustomerIdInput('');
    setErrorMessage(null);
    setMatchedGroup(null);
    setMappingActive(false);
    setMappingComplete(false);
  };

  const handleInitiate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!legalName.trim()) {
      setErrorMessage('Legal entity name is required.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setMatchedGroup(null);
    setMappingActive(false);
    setMappingComplete(false);

    try {
      // 1. Normalise name and search 5 BODS groups
      const cleanInput = normaliseEntityName(legalName);
      const match = groups.find((g) => {
        const cleanGroupName = normaliseEntityName(g.name);
        return cleanGroupName === cleanInput || cleanGroupName.includes(cleanInput) || cleanInput.includes(cleanGroupName);
      });

      if (!match) {
        setErrorMessage(
          `No matching corporate group found for "${legalName}". The Sentinel AI demo contains five mapped structures: Aurelia Maritime, Cairnstone Precision, Deccan Grid, Ouroboros Meridian, or Obsidian Wharf. Please choose a sample from above.`
        );
        setIsSubmitting(false);
        return;
      }

      setMatchedGroup(match);

      // 2. Check if this group is already onboarded in customers collection
      let custId = customerIdInput.trim();
      let createdNew = false;

      // Query customers collection for existing groupKey
      const custCol = collection(db, 'customers');
      const q = query(custCol, where('groupKey', '==', match.id));
      const existingSnap = await getDocs(q);

      if (!existingSnap.empty) {
        // Group was already onboarded! Reuse existing customer
        const existingData = existingSnap.docs[0].data();
        custId = existingData.customerId;
        createdNew = false;
      } else {
        // New onboarding
        if (!custId) {
          const randomSuffix = Math.floor(1000 + Math.random() * 9000);
          custId = `CUS-2026-${randomSuffix}`;
          createdNew = true;
        } else {
          createdNew = false;
        }

        // Persist new customer in Firestore
        if (user) {
          const customerRef = doc(db, 'customers', custId);
          await setDoc(customerRef, {
            customerId: custId,
            legalName: match.name,
            jurisdiction: match.rootJurisdiction,
            groupKey: match.id,
            onboardedBy: user.uid,
            onboardedAt: new Date().toISOString(),
            status: 'onboarded'
          });

          // Audit record
          await writeAuditRecord({
            actorUid: user.uid,
            actorType: 'HUMAN',
            actorName: profile?.displayName || 'Analyst',
            action: createdNew ? 'CUSTOMER_CREATED' : 'CUSTOMER_MATCHED',
            summary: createdNew
              ? `Customer account ${custId} generated and onboarded for ${match.name}.`
              : `Customer account ${custId} matched for ${match.name}.`,
            customerId: custId,
            groupId: match.id,
            details: {
              legalName: match.name,
              jurisdiction: match.rootJurisdiction,
              createdNew
            }
          });
        }
      }

      setResolvedCustomerId(custId);
      setIsNewCustomer(createdNew);
      setIsSubmitting(false);

      // Start Autonomous Mapping Agent Run
      runAutonomousMapping(match, custId, createdNew);
    } catch (err: any) {
      console.error('Initiation failed:', err);
      setErrorMessage(err?.message || 'Failed to initiate KYC customer profile.');
      setIsSubmitting(false);
    }
  };

  const runAutonomousMapping = async (group: any, custId: string, createdNew: boolean) => {
    setMappingActive(true);
    setMappingComplete(false);

    // Initialise steps
    const newSteps: MappingStep[] = [
      { id: 1, label: 'Resolve customer profile', detail: 'Locating KYC customer account...', status: 'running' },
      { id: 2, label: 'Load registry records', detail: 'Waiting...', status: 'waiting' },
      { id: 3, label: 'Apply change history', detail: 'Waiting...', status: 'waiting' },
      { id: 4, label: 'Resolve ownership', detail: 'Waiting...', status: 'waiting' },
      { id: 5, label: 'Flag data gaps', detail: 'Waiting...', status: 'waiting' }
    ];
    setSteps(newSteps);

    // Helper to sleep
    const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

    // STEP 1: Resolve customer profile (real delay ~700ms)
    await delay(700);
    newSteps[0].status = 'completed';
    newSteps[0].detail = createdNew
      ? `Generated new profile ${custId} · Status: Onboarded`
      : `Matched existing profile ${custId} · Status: Active`;
    newSteps[1].status = 'running';
    newSteps[1].detail = 'Fetching official PSC/ACRA registry records...';
    setSteps([...newSteps]);

    // STEP 2: Load registry records (real numbers)
    await delay(800);
    const entityCount = group.entities.length;
    const personCount = group.persons.length;
    const relCount = group.relationships.length;
    newSteps[1].status = 'completed';
    newSteps[1].detail = `Loaded ${entityCount} entities, ${personCount} natural persons, ${relCount} relationships`;
    newSteps[2].status = 'running';
    newSteps[2].detail = 'Scanning event-sourced ledger for accepted modifications...';
    setSteps([...newSteps]);

    // STEP 3: Apply change history (accepted events count from Firestore)
    await delay(700);
    let acceptedEventsCount = 0;
    try {
      const evCol = collection(db, 'events');
      const q = query(evCol, where('groupId', '==', group.id), where('status', '==', 'accepted'));
      const evSnap = await getDocs(q);
      acceptedEventsCount = evSnap.size;
    } catch {
      acceptedEventsCount = 0;
    }
    newSteps[2].status = 'completed';
    newSteps[2].detail = `Applied ${acceptedEventsCount} accepted registry change events`;
    newSteps[3].status = 'running';
    newSteps[3].detail = `Walking multi-tiered paths from ${group.name}...`;
    setSteps([...newSteps]);

    // STEP 4: Resolve ownership (real engine computation)
    await delay(900);
    const jurRule = bodsRepository.getJurisdictionRule(group.rootJurisdiction);
    const resolution = resolveBeneficialOwnership(group, jurRule?.uboThreshold ?? 25);
    newSteps[3].status = 'completed';
    newSteps[3].detail = `Walked ${resolution.pathsWalkedCount} paths across ${resolution.maxLayerDepth} layers · ${resolution.definiteCount} DEFINITE, ${resolution.possibleCount} POSSIBLE UBOs`;
    newSteps[4].status = 'running';
    newSteps[4].detail = 'Evaluating disclosure opacity and undisclosed nominee gaps...';
    setSteps([...newSteps]);

    // STEP 5: Flag data gaps (real completeness score & gaps)
    await delay(750);
    const totalGaps = resolution.gapsReached.length + resolution.implicitGaps.length;
    newSteps[4].status = 'completed';
    newSteps[4].detail = `Identified ${totalGaps} data gaps (${resolution.gapsReached.length} explicit, ${resolution.implicitGaps.length} implicit) · Completeness score: ${resolution.completenessScore}%`;
    setSteps([...newSteps]);

    setMappingComplete(true);

    // Audit mapping completion
    if (user) {
      await writeAuditRecord({
        actorUid: user.uid,
        actorType: 'AI',
        actorName: 'Sentinel Autonomous Agent',
        action: 'MAPPING_RUN_COMPLETED',
        summary: `Autonomous mapping resolved for ${group.name} (${resolution.pathsWalkedCount} paths, ${resolution.completenessScore}% completeness).`,
        customerId: custId,
        groupId: group.id,
        isAiGenerated: true,
        details: {
          definiteCount: resolution.definiteCount,
          possibleCount: resolution.possibleCount,
          completenessScore: resolution.completenessScore,
          totalGaps
        }
      });
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in pb-16">
      {/* Page Heading with Status Badge */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
          <span
            className="text-xs font-mono font-semibold tracking-wider uppercase"
            style={{ color: 'var(--emerald)' }}
          >
            Flow Step 1 · Customer Intake
          </span>
        </div>

        <h1
          className="text-2xl md:text-3xl font-bold tracking-tight"
          style={{
            fontFamily: "'Sora', sans-serif",
            background: 'linear-gradient(135deg, #FFFFFF 0%, #93C5FD 50%, #3B82F6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}
        >
          KYC Initiation &amp; Autonomous Mapping
        </h1>
        <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
          Onboard new legal entities, match against baseline registries, and initiate the autonomous multi-layer graph resolution agent.
        </p>
      </div>

      {/* "Try a sample" chips */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--ink-2)' }}>
          <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
          <span>Try a sample corporate structure:</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => handlePrefill(g)}
              type="button"
              className="text-xs font-mono px-3 py-1.5 rounded-lg transition-all duration-150 flex items-center gap-1.5 cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              style={{
                backgroundColor: legalName === g.name ? 'rgba(59, 130, 246, 0.2)' : 'var(--bg-2)',
                border: legalName === g.name ? '1px solid var(--primary)' : '1px solid var(--border)',
                color: legalName === g.name ? 'var(--primary)' : 'var(--ink-1)'
              }}
            >
              <span>{g.rootFlag}</span>
              <span className="font-sans font-medium">{g.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Form Card */}
      <div
        className="rounded-2xl p-6 transition-all duration-200 shadow-xl"
        style={{
          backgroundColor: 'var(--bg-1)',
          border: '1px solid var(--border)'
        }}
      >
        <form onSubmit={handleInitiate} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Legal Entity Name */}
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--ink-1)' }}>
                <Building2 className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
                <span>Legal Entity Name <span style={{ color: 'var(--coral)' }}>*</span></span>
              </label>
              <input
                type="text"
                required
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="e.g. Aurelia Maritime Logistics Ltd"
                className="w-full px-3.5 py-2.5 text-sm rounded-[10px] transition-all outline-none"
                style={{
                  backgroundColor: 'var(--bg-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--ink-0)'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--primary)';
                  e.currentTarget.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.25)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>

            {/* Jurisdiction */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--ink-1)' }}>
                <Globe2 className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
                <span>Incorporation Jurisdiction <span style={{ color: 'var(--coral)' }}>*</span></span>
              </label>
              <select
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-[10px] transition-all outline-none cursor-pointer"
                style={{
                  backgroundColor: 'var(--bg-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--ink-0)'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--primary)';
                  e.currentTarget.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.25)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                {jurisdictionRules.map((rule) => (
                  <option key={rule.code} value={rule.code} style={{ backgroundColor: 'var(--bg-1)' }}>
                    {rule.name} ({rule.code}) — {rule.uboThreshold}% statutory threshold
                  </option>
                ))}
              </select>
            </div>

            {/* Existing Customer ID (Optional) */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold flex items-center justify-between" style={{ color: 'var(--ink-1)' }}>
                <span className="flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
                  <span>Existing Customer ID</span>
                </span>
                <span className="text-[10px] font-mono" style={{ color: 'var(--ink-3)' }}>Optional (CUS-2026-####)</span>
              </label>
              <input
                type="text"
                value={customerIdInput}
                onChange={(e) => setCustomerIdInput(e.target.value)}
                placeholder="Leave blank to auto-generate"
                className="w-full px-3.5 py-2.5 text-sm font-mono rounded-[10px] transition-all outline-none"
                style={{
                  backgroundColor: 'var(--bg-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--ink-0)'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--primary)';
                  e.currentTarget.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.25)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>
          </div>

          {errorMessage && (
            <div
              className="p-3.5 rounded-xl text-xs flex items-start gap-2.5 animate-shake"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#F87171'
              }}
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting || !legalName.trim()}
              className="py-2.5 px-6 rounded-xl font-medium text-sm flex items-center gap-2 cursor-pointer transition-all duration-200 shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, var(--primary) 0%, #1D4ED8 100%)',
                color: '#FFFFFF'
              }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Matching Registry...</span>
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  <span>Initiate Intake &amp; Map</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Autonomous Mapping Agent Run Card (Flow Step 2) */}
      {mappingActive && matchedGroup && resolvedCustomerId && (
        <div
          className="rounded-2xl p-6 transition-all duration-300 shadow-xl space-y-6 animate-scale-up"
          style={{
            backgroundColor: 'var(--bg-1)',
            border: '1px solid var(--border)',
            boxShadow: mappingComplete
              ? '0 20px 40px -15px rgba(16, 185, 129, 0.2), 0 0 30px rgba(16, 185, 129, 0.1)'
              : '0 20px 40px -15px rgba(59, 130, 246, 0.2), 0 0 30px rgba(59, 130, 246, 0.1)'
          }}
        >
          {/* Card Header with Orb Animation */}
          <div className="flex items-center justify-between border-b pb-4" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-3">
              {/* Pulsing Orb */}
              <div className="relative flex items-center justify-center">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 ${
                    mappingComplete ? 'bg-emerald-500/20' : 'bg-blue-500/20'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full transition-all duration-500 ${
                      mappingComplete ? 'bg-emerald-500 shadow-lg shadow-emerald-500/50' : 'bg-blue-500 animate-ping'
                    }`}
                  />
                  {!mappingComplete && (
                    <div className="absolute w-4 h-4 rounded-full bg-blue-500 shadow-lg shadow-blue-500/50" />
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm" style={{ color: 'var(--ink-0)' }}>
                    Autonomous Mapping Agent
                  </h3>
                  <span
                    className="text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold"
                    style={{
                      backgroundColor: mappingComplete ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                      color: mappingComplete ? 'var(--emerald)' : 'var(--primary)'
                    }}
                  >
                    {mappingComplete ? 'READY' : 'ANALYSING'}
                  </span>
                </div>
                <p className="text-xs font-mono" style={{ color: 'var(--ink-2)' }}>
                  Target: {matchedGroup.name} · {resolvedCustomerId}
                </p>
              </div>
            </div>

            {/* Action on Complete */}
            {mappingComplete && (
              <button
                onClick={() => onOpenCustomerWorkspace(matchedGroup.id, resolvedCustomerId)}
                className="py-2 px-4 rounded-xl font-medium text-xs flex items-center gap-2 cursor-pointer transition-all duration-150 hover:scale-[1.02] active:scale-[0.98] shadow-md"
                style={{
                  background: 'linear-gradient(135deg, var(--emerald) 0%, #059669 100%)',
                  color: '#FFFFFF'
                }}
              >
                <span>Open ownership tree</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Stepper List */}
          <div className="space-y-3">
            {steps.map((st) => (
              <div
                key={st.id}
                className="flex items-start gap-3 p-3 rounded-xl transition-all duration-200"
                style={{
                  backgroundColor:
                    st.status === 'running'
                      ? 'rgba(59, 130, 246, 0.08)'
                      : st.status === 'completed'
                      ? 'rgba(16, 185, 129, 0.04)'
                      : 'transparent',
                  border:
                    st.status === 'running'
                      ? '1px solid rgba(59, 130, 246, 0.3)'
                      : st.status === 'completed'
                      ? '1px solid rgba(16, 185, 129, 0.2)'
                      : '1px solid transparent'
                }}
              >
                <div className="mt-0.5">
                  {st.status === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--emerald)' }} />
                  ) : st.status === 'running' ? (
                    <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--primary)' }} />
                  ) : (
                    <div
                      className="w-4 h-4 rounded-full border flex items-center justify-center text-[10px] font-mono"
                      style={{ borderColor: 'var(--border)', color: 'var(--ink-3)' }}
                    >
                      {st.id}
                    </div>
                  )}
                </div>

                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span
                      className="text-xs font-semibold"
                      style={{
                        color:
                          st.status === 'completed'
                            ? 'var(--ink-0)'
                            : st.status === 'running'
                            ? 'var(--primary)'
                            : 'var(--ink-2)'
                      }}
                    >
                      {st.id}. {st.label}
                    </span>
                    <span
                      className="text-[10px] font-mono"
                      style={{
                        color:
                          st.status === 'completed'
                            ? 'var(--emerald)'
                            : st.status === 'running'
                            ? 'var(--primary)'
                            : 'var(--ink-3)'
                      }}
                    >
                      {st.status.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--ink-2)' }}>
                    {st.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
