import seedJson from './bods-seed.json';
import {
  BodsSeedDataset,
  CorporateGroupSeed,
  JurisdictionRule,
} from '../types/bods';

/**
 * Read-only repository interface for BODS v0.4 baseline data.
 * Enforces immutability and schema validation at load time.
 */
export interface IBodsRepository {
  getVersion(): string;
  getJurisdictionRules(): readonly JurisdictionRule[];
  getJurisdictionRule(code: string): JurisdictionRule | undefined;
  getGroups(): readonly CorporateGroupSeed[];
  getGroupById(groupId: string): CorporateGroupSeed | undefined;
}

class ReadOnlyBodsRepository implements IBodsRepository {
  private readonly dataset: BodsSeedDataset;

  constructor(raw: unknown) {
    this.dataset = this.validateDataset(raw);
  }

  private validateDataset(raw: unknown): BodsSeedDataset {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Invalid BODS seed dataset: root must be an object.');
    }
    const data = raw as BodsSeedDataset;
    if (data.synthetic !== true) {
      throw new Error('Security policy violation: Dataset must carry synthetic: true.');
    }
    if (!Array.isArray(data.groups) || data.groups.length === 0) {
      throw new Error('Invalid BODS seed dataset: groups array is missing or empty.');
    }
    for (const group of data.groups) {
      if (group.synthetic !== true) {
        throw new Error(`Security policy violation: Group ${group.id} must carry synthetic: true.`);
      }
      for (const person of group.persons) {
        if (person.synthetic !== true) {
          throw new Error(`Security policy violation: Person ${person.id} must carry synthetic: true.`);
        }
        if (typeof person.yearOfBirth !== 'number') {
          throw new Error(`Validation error: Person ${person.id} missing yearOfBirth.`);
        }
      }
      if (!Array.isArray(group.monitoringEventTemplates) || group.monitoringEventTemplates.length < 2) {
        throw new Error(`Validation error: Group ${group.id} must have at least 2 monitoringEventTemplates.`);
      }
    }
    return Object.freeze(data);
  }

  public getVersion(): string {
    return this.dataset.version;
  }

  public getJurisdictionRules(): readonly JurisdictionRule[] {
    return this.dataset.jurisdictionRules;
  }

  public getJurisdictionRule(code: string): JurisdictionRule | undefined {
    return this.dataset.jurisdictionRules.find((r) => r.code === code);
  }

  public getGroups(): readonly CorporateGroupSeed[] {
    return this.dataset.groups;
  }

  public getGroupById(groupId: string): CorporateGroupSeed | undefined {
    return this.dataset.groups.find((g) => g.id === groupId);
  }
}

export const bodsRepository: IBodsRepository = new ReadOnlyBodsRepository(seedJson);
