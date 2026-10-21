/**
 * BODS v0.4 (Beneficial Ownership Data Standard v0.4) Domain Model
 * Sentinel AI — Phase 1
 */

export type EntityType = 'company' | 'trust' | 'partnership' | 'fund' | 'foundation';
export type EntityStatus = 'active' | 'dissolved' | 'sanctioned';

export interface EntityRecord {
  id: string;
  name: string;
  displayLines: [string] | [string, string];
  entityType: EntityType;
  jurisdictionCode: string;
  countryFlag: string;
  registrationId: string;
  status: EntityStatus;
  sanctionsProgramme?: string;
  registeredAddress: string;
  source: string;
  asOfDate: string;
  positionOverride?: { x: number; y: number };
}

export type PepStatus = 'none' | 'domestic' | 'foreign' | 'international_organisation';

export interface PersonRecord {
  id: string;
  name: string;
  initials: string;
  nationality: string;
  flag: string;
  yearOfBirth: number;
  pepStatus: PepStatus;
  pepRoleDescription?: string;
  synthetic: true;
  positionOverride?: { x: number; y: number };
}

export type InterestType =
  | 'shareholding'
  | 'voting_rights'
  | 'appointment_of_board'
  | 'other_influence_or_control'
  | 'trustee'
  | 'settlor'
  | 'beneficiary_of_trust'
  | 'nominee';

export interface ExactShare {
  kind: 'exact';
  value: number; // Percentage 0..100
}

export interface RangeShare {
  kind: 'range';
  min: number; // Percentage 0..100
  max: number; // Percentage 0..100
}

export type ShareSpec = ExactShare | RangeShare;

export interface InterestDetail {
  type: InterestType;
  share: ShareSpec;
  directOrIndirect: 'direct' | 'indirect';
  source: string;
  asOfDate: string;
  confidence: number; // 0..1
  shareClass?: string;
}

export type PartyType = 'entity' | 'person' | 'unspecified';

export interface RelationshipRecord {
  id: string;
  subjectId: string; // The owned entity ID
  interestedPartyId: string; // The owner ID (entity, person, or unspecified record)
  interestedPartyType: PartyType;
  interests: InterestDetail[];
  isHot?: boolean; // Recently changed edge
  isHistorical?: boolean;
}

export type UnspecifiedReason =
  | 'unknown'
  | 'subject_unable_to_confirm'
  | 'information_withheld'
  | 'nominee_undisclosed';

export interface UnspecifiedOwnerRecord {
  id: string;
  label: string;
  reason: UnspecifiedReason;
  reasonDisplay: string;
  description: string;
  estimatedImpactOnCompleteness: number; // 0..100 points deducted from completeness
  jurisdictionCode?: string;
  countryFlag?: string;
  source: string;
  asOfDate: string;
  positionOverride?: { x: number; y: number };
}

export type ThresholdComparison = 'strictly_greater' | 'greater_or_equal';

export interface JurisdictionRule {
  code: string;
  name: string;
  uboThreshold: number; // e.g., 25 or 10
  comparison: ThresholdComparison; // 'strictly_greater' (> threshold) or 'greater_or_equal' (>= threshold)
  regulationName: string;
  verified: boolean;
}

export type MonitoringChangeType =
  | 'SHARE_CHANGE'
  | 'NEW_RELATIONSHIP'
  | 'RELATIONSHIP_ENDED'
  | 'ENTITY_DISSOLVED';

export interface ShareChangeEventData {
  changeType: 'SHARE_CHANGE';
  relationshipId: string;
  beforeShare: ShareSpec;
  afterShare: ShareSpec;
}

export interface NewRelationshipEventData {
  changeType: 'NEW_RELATIONSHIP';
  relationship: RelationshipRecord;
  newEntity?: EntityRecord;
  newPerson?: PersonRecord;
  newUnspecifiedOwner?: UnspecifiedOwnerRecord;
}

export interface RelationshipEndedEventData {
  changeType: 'RELATIONSHIP_ENDED';
  relationshipId: string;
}

export interface EntityDissolvedEventData {
  changeType: 'ENTITY_DISSOLVED';
  entityId: string;
  dissolvedDate: string;
}

export type MonitoringEventPayload =
  | ShareChangeEventData
  | NewRelationshipEventData
  | RelationshipEndedEventData
  | EntityDissolvedEventData;

export interface MonitoringEventTemplate {
  id: string;
  groupId: string;
  changeType: MonitoringChangeType;
  data: MonitoringEventPayload;
  description: string;
  source: string;
  confidence: number; // 0..1
  expectedMaterialityHint?: 'MATERIAL' | 'MONITOR';
}

export type ScenarioTrait = 'pep' | 'banded' | 'cross_border' | 'cycle' | 'data_gap';

export interface CorporateGroupSeed {
  id: string;
  name: string;
  rootEntityId: string;
  rootJurisdiction: string;
  rootFlag: string;
  description: string;
  scenarioSummary: string;
  iconName: 'shield' | 'layers' | 'scale' | 'refresh' | 'eye_off';
  accentColor: 'amber' | 'primary' | 'emerald' | 'coral' | 'grey';
  riskTier: 'HIGH RISK' | 'ELEVATED' | 'STANDARD' | 'REVIEW REQUIRED' | 'OPAQUE STRUCTURE';
  riskTone: 'rose' | 'amber' | 'emerald' | 'primary' | 'grey';
  traits: ScenarioTrait[];
  entities: EntityRecord[];
  persons: PersonRecord[];
  unspecifiedOwners: UnspecifiedOwnerRecord[];
  relationships: RelationshipRecord[];
  monitoringEventTemplates: MonitoringEventTemplate[];
  synthetic: true;
}

export interface BodsSeedDataset {
  version: string;
  standard: 'BODS v0.4';
  synthetic: true;
  generatedAt: string;
  jurisdictionRules: JurisdictionRule[];
  groups: CorporateGroupSeed[];
}

export type BodsPerson = PersonRecord;
export type BodsEntity = EntityRecord;
