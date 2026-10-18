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
  ShieldAlert,
  Play
} from 'lucide-react';
import { normaliseEntityName } from '../engine/sanctionsNormalizer';

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
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [jurisdiction, setJurisdiction] = useState('UK');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Match Result State
  const [matchedGroup, setMatchedGroup] = useState<any | null>(null);
  const [resolvedCustomerId, setResolvedCustomerId] = useState<string | null>(null);
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [mappingActive, setMappingActive] = useState(false);
  const [mappingComplete, setMappingComplete] = useState(false);

  // Helper to match candidate demo group from name or registration number
  const findMatchedGroup = (nameVal: string, regVal: string) => {
    const cleanReg = regVal.trim().toUpperCase();
    const cleanName = normaliseEntityName(nameVal.trim());

    return groups.find((g) => {
      const rootEntity = g.entities.find((e) => e.id === g.rootEntityId);
      // Match by exact registration number
      if (cleanReg) {
        if (rootEntity?.registrationId?.toUpperCase() === cleanReg) return true;
        if (g.entities.some((e) => e.registrationId?.toUpperCase() === cleanReg)) return true;
      }
      // Match by legal name
      if (cleanName) {
        const cleanGroupName = normaliseEntityName(g.name);
        if (cleanGroupName === cleanName || cleanGroupName.includes(cleanName) || cleanName.includes(cleanGroupName)) {
          return true;
        }
        if (rootEntity) {
          const cleanRootName = normaliseEntityName(rootEntity.name);
          if (cleanRootName === cleanName || cleanRootName.includes(cleanName) || cleanName.includes(cleanRootName)) {
            return true;
          }
        }
      }
      return false;
    });
  };

  // Agent Steps State
  const [steps, setSteps] = useState<MappingStep[]>([
    { id: 1, label: 'Resolve customer profile', detail: 'Pending customer identification...', status: 'waiting' },
    { id: 2, label: 'Load registry records', detail: 'Waiting for intake...', status: 'waiting' },
    { id: 3, label: 'Apply change history', detail: 'Waiting for registry events...', status: 'waiting' },
    { id: 4, label: 'Resolve ownership', detail: 'Awaiting graph traversal...', status: 'waiting' },
    { id: 5, label: 'Flag data gaps', detail: 'Calculating completeness index...', status: 'waiting' }
  ]);

  const handlePrefill = (group: any) => {
    const rootEntity = group.entities.find((e: any) => e.id === group.rootEntityId);
    setLegalName(group.name);
    setRegistrationNumber(rootEntity?.registrationId || '');
    setJurisdiction(group.rootJurisdiction);
    setErrorMessage(null);
    setMatchedGroup(null);
    setMappingActive(false);
    setMappingComplete(false);
  };

  const handleInitiate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!legalName.trim() && !registrationNumber.trim()) {
      setErrorMessage('This demo recognises five sample corporate structures. Try one of the examples above.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setMatchedGroup(null);
    setMappingActive(false);
    setMappingComplete(false);

    try {
      // 1. Search 5 BODS groups by name OR registration number
      const match = findMatchedGroup(legalName, registrationNumber);

      if (!match) {
        setErrorMessage(
          'This demo recognises five sample corporate structures. Try one of the examples above.'
        );
        setIsSubmitting(false);
        return;
      }

      setMatchedGroup(match);

      // 2. Check if this group is already onboarded in customers collection to prevent duplicates
      let custId = '';
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
        // New onboarding auto-generated customer ID
        const randomSuffix = Math.floor(1000 + Math.random() * 9000);
        custId = `CUS-2026-${randomSuffix}`;
        createdNew = true;

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
            action: 'CUSTOMER_CREATED',
            summary: `Customer account ${custId} generated and onboarded for ${match.name}.`,
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

        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight font-display sig-gradient-headline">
          KYC Initiation &amp; Autonomous Mapping
        </h1>
        <p className="text-sm" style={{ color: 'var(--ink2)' }}>
          Onboard new legal entities, match against baseline registries, and initiate the autonomous multi-layer graph resolution agent.
        </p>
      </div>

      {/* "Try a sample" chips */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--ink2)' }}>
          <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
          <span>Try a sample corporate structure:</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {groups.map((g) => {
            const isSelected = legalName === g.name;
            return (
              <button
                key={g.id}
                onClick={() => handlePrefill(g)}
                type="button"
                className="text-xs font-mono-code px-3 py-1.5 rounded-lg transition-all duration-150 flex items-center gap-1.5 cursor-pointer focus-visible:ring-2"
                style={{
                  backgroundColor: isSelected ? 'var(--bg2)' : 'transparent',
                  border: isSelected ? '1px solid var(--ink)' : '1px solid var(--line)',
                  color: isSelected ? 'var(--ink)' : 'var(--ink2)',
                }}
              >
                <span>{g.rootFlag}</span>
                <span className="font-sans font-medium">{g.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Form Card */}
      <div
        className="rounded-2xl p-6 transition-all duration-200 shadow-xl"
        style={{
          backgroundColor: 'var(--card)',
          border: '1px solid var(--line)'
        }}
      >
        <form onSubmit={handleInitiate} className="space-y-5">
          <div className="grid grid-cols-1 min-[900px]:grid-cols-2 gap-4">
            {/* Legal Entity Name */}
            <div className="space-y-1.5 min-[900px]:col-span-2 col-span-1">
              <label className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
                <Building2 className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
                <span>Legal Entity Name <span style={{ color: 'var(--coral)' }}>*</span></span>
              </label>
              <input
                type="text"
                value={legalName}
                onChange={(e) => {
                  setLegalName(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="e.g. Aurelia Maritime Logistics Ltd"
                className="w-full px-3.5 py-2.5 text-sm rounded-[10px] transition-all outline-none focus-visible:ring-2"
                style={{
                  backgroundColor: 'var(--bg2)',
                  border: '1px solid var(--line)',
                  color: 'var(--ink)'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--primary)';
                  e.currentTarget.style.boxShadow = '0 0 0 2px rgba(1, 110, 253, 0.25)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--line)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>

            {/* Registration number (Optional) - placed after Legal Entity Name and before Jurisdiction */}
            <div className="space-y-1.5 col-span-1">
              <label className="text-xs font-semibold flex items-center justify-between" style={{ color: 'var(--ink)' }}>
                <span className="flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
                  <span>Registration number</span>
                </span>
                <span className="text-[10px] font-mono-code" style={{ color: 'var(--ink3)' }}>Optional</span>
              </label>
              <input
                type="text"
                value={registrationNumber}
                onChange={(e) => {
                  setRegistrationNumber(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="e.g. UK-CH-10948211"
                className="w-full px-3.5 py-2.5 text-sm font-mono-code rounded-[10px] transition-all outline-none focus-visible:ring-2"
                style={{
                  backgroundColor: 'var(--bg2)',
                  border: '1px solid var(--line)',
                  color: 'var(--ink)'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--primary)';
                  e.currentTarget.style.boxShadow = '0 0 0 2px rgba(1, 110, 253, 0.25)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--line)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>

            {/* Jurisdiction */}
            <div className="space-y-1.5 col-span-1">
              <label className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
                <Globe2 className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
                <span>Incorporation Jurisdiction <span style={{ color: 'var(--coral)' }}>*</span></span>
              </label>
              <select
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-[10px] transition-all outline-none cursor-pointer focus-visible:ring-2"
                style={{
                  backgroundColor: 'var(--bg2)',
                  border: '1px solid var(--line)',
                  color: 'var(--ink)'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--primary)';
                  e.currentTarget.style.boxShadow = '0 0 0 2px rgba(1, 110, 253, 0.25)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--line)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                {jurisdictionRules.map((rule) => {
                  const countryName = rule.code === 'EU' ? 'Luxembourg' : rule.name;
                  return (
                    <option key={rule.code} value={rule.code} style={{ backgroundColor: 'var(--card)' }}>
                      {countryName}
                    </option>
                  );
                })}
              </select>
              {(() => {
                const selectedRule = jurisdictionRules.find((r) => r.code === jurisdiction);
                if (!selectedRule) return null;
                const thresholdText =
                  selectedRule.comparison === 'strictly_greater'
                    ? `more than ${selectedRule.uboThreshold}%`
                    : `${selectedRule.uboThreshold}% or more`;
                return (
                  <p className="text-[11px] font-mono-code mt-1" style={{ color: 'var(--ink2)' }}>
                    UBO threshold: {thresholdText} · {selectedRule.regulationName}
                  </p>
                );
              })()}
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

          {/* Button with play-style right-pointing arrow, loading state, and disabled tooltip */}
          {(() => {
            if (mappingComplete) {
              return null;
            }

            const hasInput = legalName.trim().length > 0 || registrationNumber.trim().length > 0;
            const candidateMatch = hasInput ? findMatchedGroup(legalName, registrationNumber) : null;
            const isButtonDisabled = isSubmitting || mappingActive || !hasInput || !candidateMatch;

            let buttonTooltip = 'Initiate customer intake and run autonomous ownership mapping';
            if (mappingActive || isSubmitting) {
              buttonTooltip = 'Mapping is currently running...';
            } else if (!hasInput) {
              buttonTooltip = 'Please enter a Legal Entity Name or Registration Number to proceed';
            } else if (!candidateMatch) {
              buttonTooltip = 'This demo recognises five sample corporate structures. Try one of the examples above.';
            }

            return (
              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={isButtonDisabled}
                  title={buttonTooltip}
                  aria-label="Initiate Intake & Map"
                  className="py-2.5 px-6 rounded-xl font-medium text-sm flex items-center gap-2 cursor-pointer transition-all duration-200 shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2"
                  style={{
                    background: 'linear-gradient(135deg, var(--primary) 0%, #1D4ED8 100%)',
                    color: '#FFFFFF'
                  }}
                >
                  {isSubmitting || mappingActive ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Matching &amp; Mapping...</span>
                    </>
                  ) : (
                    <>
                      <span>Initiate Intake &amp; Map</span>
                      <Play className="w-3.5 h-3.5 fill-current ml-1" aria-hidden="true" />
                    </>
                  )}
                </button>
              </div>
            );
          })()}
        </form>
      </div>

      {/* Autonomous Mapping Agent Run Card (Flow Step 2) */}
      {mappingActive && matchedGroup && resolvedCustomerId && (
        <div
          className="rounded-2xl p-6 transition-all duration-300 shadow-xl space-y-6 animate-scale-up"
          style={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--line)',
            boxShadow: mappingComplete
              ? '0 20px 40px -15px rgba(5, 150, 105, 0.15), 0 0 30px rgba(5, 150, 105, 0.08)'
              : '0 20px 40px -15px rgba(1, 110, 253, 0.15), 0 0 30px rgba(1, 110, 253, 0.08)'
          }}
        >
          {/* Card Header with Orb Animation */}
          <div className="flex items-center justify-between border-b pb-4" style={{ borderColor: 'var(--line)' }}>
            <div className="flex items-center gap-3">
              {/* Pulsing Orb */}
              <div className="relative flex items-center justify-center">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 ${
                    mappingComplete ? 'bg-emerald-500/15' : 'bg-blue-500/15'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full transition-all duration-500 ${
                      mappingComplete ? 'bg-emerald-600 shadow-lg shadow-emerald-500/50' : 'bg-blue-600 animate-ping'
                    }`}
                  />
                  {!mappingComplete && (
                    <div className="absolute w-4 h-4 rounded-full bg-blue-600 shadow-lg shadow-blue-500/50" />
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>
                    Autonomous Mapping Agent
                  </h3>
                  <span
                    className="text-[10px] font-mono-code px-2 py-0.5 rounded-full font-semibold"
                    style={{
                      backgroundColor: mappingComplete ? 'var(--emerald-s)' : 'var(--primary-s)',
                      color: mappingComplete ? 'var(--emerald)' : 'var(--primary)'
                    }}
                  >
                    {mappingComplete ? 'READY' : 'ANALYSING'}
                  </span>
                </div>
                <p className="text-xs font-mono-code" style={{ color: 'var(--ink2)' }}>
                  Target: {matchedGroup.name} · {resolvedCustomerId}
                </p>
              </div>
            </div>

            {/* Action on Complete */}
            {mappingComplete && (
              <button
                onClick={() => onOpenCustomerWorkspace(matchedGroup.id, resolvedCustomerId)}
                className="py-2 px-4 rounded-xl font-medium text-xs flex items-center gap-2 cursor-pointer transition-all duration-150 hover:scale-[1.02] active:scale-[0.98] shadow-md focus-visible:ring-2"
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
                      ? 'var(--primary-s)'
                      : st.status === 'completed'
                      ? 'var(--emerald-s)'
                      : 'transparent',
                  border:
                    st.status === 'running'
                      ? '1px solid rgba(1, 110, 253, 0.3)'
                      : st.status === 'completed'
                      ? '1px solid rgba(5, 150, 105, 0.2)'
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
                      className="w-4 h-4 rounded-full border flex items-center justify-center text-[10px] font-mono-code"
                      style={{ borderColor: 'var(--line)', color: 'var(--ink3)' }}
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
                            ? 'var(--ink)'
                            : st.status === 'running'
                            ? 'var(--primary)'
                            : 'var(--ink2)'
                      }}
                    >
                      {st.id}. {st.label}
                    </span>
                    <span
                      className="text-[10px] font-mono-code"
                      style={{
                        color:
                          st.status === 'completed'
                            ? 'var(--emerald)'
                            : st.status === 'running'
                            ? 'var(--primary)'
                            : 'var(--ink3)'
                      }}
                    >
                      {st.status.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs font-mono-code mt-0.5" style={{ color: 'var(--ink2)' }}>
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
