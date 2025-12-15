/**
 * IPFS Wrapper API client
 */

export interface Entity {
  pi: string;
  tip: string;
  ver: number;
  components: Record<string, string>;
  children_pi?: string[];
  parent_pi?: string;
}

export interface AppendVersionResult {
  tip: string;
  ver: number;
}

export class IPFSClient {
  constructor(private fetcher: Fetcher) {}

  /**
   * Get entity by PI
   */
  async getEntity(pi: string): Promise<Entity> {
    const resp = await this.fetcher.fetch(`https://api/entities/${pi}`);
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to get entity ${pi}: ${resp.status} - ${text}`);
    }
    const result: any = await resp.json();
    // API returns manifest_cid, map to tip for consistency
    return {
      ...result,
      tip: result.tip || result.manifest_cid,
    };
  }

  /**
   * Download content by CID
   */
  async downloadContent(cid: string): Promise<string> {
    const resp = await this.fetcher.fetch(`https://api/cat/${cid}`);
    if (!resp.ok) {
      throw new Error(`Failed to download ${cid}: ${resp.status}`);
    }
    return resp.text();
  }

  /**
   * Upload content and return CID
   * Uses multipart/form-data as required by the IPFS wrapper API
   */
  async uploadContent(content: string, filename: string = 'content.txt'): Promise<string> {
    // Create FormData with the content as a file
    const formData = new FormData();
    const blob = new Blob([content], { type: 'text/plain' });
    formData.append('file', blob, filename);

    const resp = await this.fetcher.fetch('https://api/upload', {
      method: 'POST',
      body: formData,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to upload content: ${resp.status} - ${text}`);
    }
    // Response is an array of uploaded files
    const data = (await resp.json()) as Array<{ cid: string; name: string; size: number }>;
    if (!data || data.length === 0) {
      throw new Error('Upload returned empty response');
    }
    return data[0].cid;
  }

  /**
   * Append a new version to an entity
   */
  async appendVersion(
    pi: string,
    currentTip: string,
    components: Record<string, string>,
    note: string
  ): Promise<AppendVersionResult> {
    const resp = await this.fetcher.fetch(`https://api/entities/${pi}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expect_tip: currentTip,
        components,
        note,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to append version to ${pi}: ${resp.status} - ${text}`);
    }

    return resp.json();
  }
}
