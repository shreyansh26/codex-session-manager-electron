import {
  searchIndexThreadPayloadSchema,
  searchQueryRequestSchema,
  type SearchBootstrapStatusRecord,
  type SearchIndexThreadPayloadRecord,
  type SearchQueryRequestRecord,
  type SearchQueryResponseRecord
} from "../../../shared/schema/contracts";
import { SearchIndex, type SearchIndexOptions } from "./searchIndex";

export interface SearchIndexServiceOptions extends SearchIndexOptions {
  searchIndexPath: string;
}

export class SearchIndexService {
  private constructor(
    private readonly searchIndexPath: string,
    private readonly index: SearchIndex
  ) {}

  static async create(options: SearchIndexServiceOptions): Promise<SearchIndexService> {
    const index = await SearchIndex.loadFromPath(options.searchIndexPath, {
      nowMs: options.nowMs
    });
    return new SearchIndexService(options.searchIndexPath, index);
  }

  async upsertThread(payload: SearchIndexThreadPayloadRecord): Promise<void> {
    const parsed = searchIndexThreadPayloadSchema.parse(payload);
    this.index.upsertThread(parsed);
    await this.index.persistToPath(this.searchIndexPath);
  }

  async removeDevice(deviceId: string): Promise<number> {
    const removedSessions = this.index.removeDevice(deviceId);
    if (removedSessions === 0) {
      return removedSessions;
    }

    await this.index.persistToPath(this.searchIndexPath);
    return removedSessions;
  }

  query(request: SearchQueryRequestRecord): SearchQueryResponseRecord {
    const parsed = searchQueryRequestSchema.parse(request);
    return this.index.query(parsed);
  }

  bootstrapStatus(): SearchBootstrapStatusRecord {
    return this.index.bootstrapStatus();
  }
}
