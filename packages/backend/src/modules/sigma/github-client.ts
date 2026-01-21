/**
 * GitHub API Client for SigmaHQ Repository
 *
 * Fetches Sigma rules from https://github.com/SigmaHQ/sigma
 */

import { connection as redis, isRedisAvailable } from '../../queue/connection.js';

// Cache TTLs (in seconds)
const CACHE_TTL = {
  COMMIT: 3600,        // 1 hour
  CATEGORIES: 86400,   // 24 hours
  RULES: 21600,        // 6 hours
} as const;

// Cache helper functions (handle Redis unavailability)
async function cacheGet(key: string): Promise<string | null> {
  if (!isRedisAvailable() || !redis) return null;
  return redis.get(key);
}

async function cacheSet(key: string, ttl: number, value: string): Promise<void> {
  if (!isRedisAvailable() || !redis) return;
  await redis.setex(key, ttl, value);
}

interface GitHubTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

interface GitHubTreeResponse {
  sha: string;
  url: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

interface GitHubContentResponse {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string;
  type: 'file' | 'dir';
  content?: string; // Base64 encoded
  encoding?: string;
}

export interface SigmaRuleFile {
  path: string;
  name: string;
  category: string; // e.g., "windows/process_creation", "linux/auditd"
  downloadUrl: string;
  sha: string;
}

export interface SigmaCategory {
  name: string;
  path: string;
  ruleCount: number;
  subcategories?: string[];
}

export interface SigmaRuleMetadata {
  path: string;
  name: string;
  title?: string;
  level?: string;
  description?: string;
  tags?: string[];
  category: string;
  downloadUrl: string;
  sha: string;
}

export interface CategoryTreeNode {
  name: string;
  path: string;
  type: 'category';
  ruleCount: number;
  children?: CategoryTreeNode[];
}

export class SigmaHQClient {
  private readonly baseUrl = 'https://api.github.com';
  private readonly repo = 'SigmaHQ/sigma';
  private readonly rulesPath = 'rules';
  private readonly headers: HeadersInit;

  constructor(githubToken?: string) {
    this.headers = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'LogTide-SigmaHQ-Client',
    };

    if (githubToken) {
      this.headers['Authorization'] = `Bearer ${githubToken}`;
    }
  }

  /**
   * Get the latest commit SHA for the main branch
   */
  async getLatestCommit(): Promise<string> {
    const cacheKey = 'sigma:cache:commit';

    // Try cache first
    try {
      const cached = await cacheGet(cacheKey);
      if (cached) {
        console.log('[SigmaHQ] Using cached commit hash');
        return cached;
      }
    } catch (error) {
      console.warn('[SigmaHQ] Redis cache error, fetching from GitHub:', error);
    }

    const url = `${this.baseUrl}/repos/${this.repo}/commits/master`;

    const response = await fetch(url, { headers: this.headers });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const commit = data.sha;

    // Cache the result
    try {
      await cacheSet(cacheKey, CACHE_TTL.COMMIT, commit);
    } catch (error) {
      console.warn('[SigmaHQ] Failed to cache commit hash:', error);
    }

    return commit;
  }

  /**
   * Get all available categories from the rules directory
   */
  async getCategories(): Promise<SigmaCategory[]> {
    const cacheKey = 'sigma:cache:categories';

    // Try cache first
    try {
      const cached = await cacheGet(cacheKey);
      if (cached) {
        console.log('[SigmaHQ] Using cached categories');
        return JSON.parse(cached);
      }
    } catch (error) {
      console.warn('[SigmaHQ] Redis cache error, fetching from GitHub:', error);
    }

    const url = `${this.baseUrl}/repos/${this.repo}/contents/${this.rulesPath}`;

    const response = await fetch(url, { headers: this.headers });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const contents: GitHubContentResponse[] = await response.json();

    const categories: SigmaCategory[] = [];

    for (const item of contents) {
      if (item.type === 'dir') {
        // Count rules in this category
        const ruleCount = await this.countRulesInCategory(item.path);

        // Get subcategories
        const subcategories = await this.getSubcategories(item.path);

        categories.push({
          name: item.name,
          path: item.path,
          ruleCount,
          subcategories,
        });
      }
    }

    // Cache the result
    try {
      await cacheSet(cacheKey, CACHE_TTL.CATEGORIES, JSON.stringify(categories));
    } catch (error) {
      console.warn('[SigmaHQ] Failed to cache categories:', error);
    }

    return categories;
  }

  /**
   * Get subcategories for a given category
   */
  private async getSubcategories(categoryPath: string): Promise<string[]> {
    const url = `${this.baseUrl}/repos/${this.repo}/contents/${categoryPath}`;

    try {
      const response = await fetch(url, { headers: this.headers });

      if (!response.ok) {
        return [];
      }

      const contents: GitHubContentResponse[] = await response.json();

      return contents
        .filter(item => item.type === 'dir')
        .map(item => item.name);
    } catch {
      return [];
    }
  }

  /**
   * Count rules in a category (recursively)
   */
  private async countRulesInCategory(categoryPath: string): Promise<number> {
    try {
      const rules = await this.fetchRulesByCategory(categoryPath);
      return rules.length;
    } catch {
      return 0;
    }
  }

  /**
   * Fetch all rule files from a specific category (recursive)
   */
  async fetchRulesByCategory(category: string): Promise<SigmaRuleFile[]> {
    const categoryPath = category.startsWith(this.rulesPath)
      ? category
      : `${this.rulesPath}/${category}`;

    const cacheKey = `sigma:cache:rules:${category}`;

    // Try cache first
    try {
      const cached = await cacheGet(cacheKey);
      if (cached) {
        console.log(`[SigmaHQ] Using cached rules for category: ${category}`);
        return JSON.parse(cached);
      }
    } catch (error) {
      console.warn('[SigmaHQ] Redis cache error, fetching from GitHub:', error);
    }

    // Use Git Tree API for recursive fetching (more efficient)
    const commit = await this.getLatestCommit();
    const url = `${this.baseUrl}/repos/${this.repo}/git/trees/${commit}?recursive=1`;

    const response = await fetch(url, { headers: this.headers });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const treeData: GitHubTreeResponse = await response.json();

    const rules: SigmaRuleFile[] = [];

    for (const item of treeData.tree) {
      // Filter for .yml/.yaml files in the category
      if (
        item.type === 'blob' &&
        item.path.startsWith(categoryPath) &&
        (item.path.endsWith('.yml') || item.path.endsWith('.yaml'))
      ) {
        const fileName = item.path.split('/').pop() || item.path;
        const relativePath = item.path.replace(`${this.rulesPath}/`, '');
        const categoryName = relativePath.split('/').slice(0, -1).join('/');

        rules.push({
          path: item.path,
          name: fileName,
          category: categoryName,
          downloadUrl: `https://raw.githubusercontent.com/${this.repo}/master/${item.path}`,
          sha: item.sha,
        });
      }
    }

    // Cache the result
    try {
      await cacheSet(cacheKey, CACHE_TTL.RULES, JSON.stringify(rules));
    } catch (error) {
      console.warn('[SigmaHQ] Failed to cache rules:', error);
    }

    return rules;
  }

  /**
   * Fetch a single rule's YAML content
   */
  async fetchRule(path: string): Promise<string> {
    const downloadUrl = path.startsWith('http')
      ? path
      : `https://raw.githubusercontent.com/${this.repo}/master/${path}`;

    const response = await fetch(downloadUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch rule: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  }

  /**
   * Search rules by tag (using GitHub Code Search API)
   */
  async searchRulesByTag(tag: string): Promise<SigmaRuleFile[]> {
    const query = `repo:${this.repo} path:rules/ "${tag}" extension:yml`;
    const url = `${this.baseUrl}/search/code?q=${encodeURIComponent(query)}&per_page=100`;

    const response = await fetch(url, { headers: this.headers });

    if (!response.ok) {
      throw new Error(`GitHub Search API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    const rules: SigmaRuleFile[] = data.items.map((item: any) => {
      const categoryName = item.path.replace(`${this.rulesPath}/`, '').split('/').slice(0, -1).join('/');

      return {
        path: item.path,
        name: item.name,
        category: categoryName,
        downloadUrl: `https://raw.githubusercontent.com/${this.repo}/master/${item.path}`,
        sha: item.sha,
      };
    });

    return rules;
  }

  /**
   * Fetch all rules (all categories) - WARNING: This can take a while!
   */
  async fetchAllRules(): Promise<SigmaRuleFile[]> {
    const cacheKey = 'sigma:cache:rules:all';

    // Try cache first
    try {
      const cached = await cacheGet(cacheKey);
      if (cached) {
        console.log('[SigmaHQ] Using cached all rules');
        return JSON.parse(cached);
      }
    } catch (error) {
      console.warn('[SigmaHQ] Redis cache error, fetching from GitHub:', error);
    }

    console.log('[SigmaHQ] Fetching all rules from SigmaHQ repository...');

    const commit = await this.getLatestCommit();
    console.log(`[SigmaHQ] Latest commit: ${commit}`);

    const url = `${this.baseUrl}/repos/${this.repo}/git/trees/${commit}?recursive=1`;

    const response = await fetch(url, { headers: this.headers });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const treeData: GitHubTreeResponse = await response.json();

    const rules: SigmaRuleFile[] = [];

    for (const item of treeData.tree) {
      // Filter for .yml/.yaml files in rules directory
      if (
        item.type === 'blob' &&
        item.path.startsWith(this.rulesPath + '/') &&
        (item.path.endsWith('.yml') || item.path.endsWith('.yaml'))
      ) {
        const fileName = item.path.split('/').pop() || item.path;
        const relativePath = item.path.replace(`${this.rulesPath}/`, '');
        const categoryName = relativePath.split('/').slice(0, -1).join('/');

        rules.push({
          path: item.path,
          name: fileName,
          category: categoryName,
          downloadUrl: `https://raw.githubusercontent.com/${this.repo}/master/${item.path}`,
          sha: item.sha,
        });
      }
    }

    console.log(`[SigmaHQ] Found ${rules.length} rules`);

    // Cache the result
    try {
      await cacheSet(cacheKey, CACHE_TTL.RULES, JSON.stringify(rules));
    } catch (error) {
      console.warn('[SigmaHQ] Failed to cache all rules:', error);
    }

    return rules;
  }

  /**
   * Build hierarchical category tree from flat category list
   */
  async buildCategoryTree(): Promise<CategoryTreeNode[]> {
    const cacheKey = 'sigma:cache:tree';

    // Try cache first
    try {
      const cached = await cacheGet(cacheKey);
      if (cached) {
        console.log('[SigmaHQ] Using cached category tree');
        return JSON.parse(cached);
      }
    } catch (error) {
      console.warn('[SigmaHQ] Redis cache error, fetching from GitHub:', error);
    }

    const categories = await this.getCategories();
    const tree: CategoryTreeNode[] = [];

    // Build tree structure
    for (const category of categories) {
      const parts = category.path.replace(this.rulesPath + '/', '').split('/');

      let currentLevel = tree;
      let currentPath = this.rulesPath;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        currentPath += '/' + part;

        let existingNode = currentLevel.find((node) => node.name === part);

        if (!existingNode) {
          existingNode = {
            name: part,
            path: currentPath,
            type: 'category',
            ruleCount: i === parts.length - 1 ? category.ruleCount : 0,
            children: [],
          };
          currentLevel.push(existingNode);
        }

        currentLevel = existingNode.children!;
      }
    }

    // Cache the result
    try {
      await cacheSet(cacheKey, CACHE_TTL.CATEGORIES, JSON.stringify(tree));
    } catch (error) {
      console.warn('[SigmaHQ] Failed to cache category tree:', error);
    }

    return tree;
  }

  /**
   * Get rules for a specific category with optional metadata
   */
  async getRulesForCategory(
    categoryPath: string,
    includeMetadata: boolean = false
  ): Promise<SigmaRuleMetadata[]> {
    const rules = await this.fetchRulesByCategory(categoryPath);

    if (!includeMetadata) {
      return rules.map((rule) => ({
        path: rule.path,
        name: rule.name,
        category: rule.category,
        downloadUrl: rule.downloadUrl,
        sha: rule.sha,
      }));
    }

    // Fetch metadata for each rule (YAML parsing)
    const rulesWithMetadata: SigmaRuleMetadata[] = [];

    // Limit concurrent fetches to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < rules.length; i += batchSize) {
      const batch = rules.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (rule) => {
          try {
            const yaml = await this.fetchRule(rule.downloadUrl);
            const metadata = this.parseRuleMetadata(yaml);

            return {
              ...rule,
              title: metadata.title,
              level: metadata.level,
              description: metadata.description,
              tags: metadata.tags,
            };
          } catch (error) {
            console.warn(`[SigmaHQ] Failed to fetch metadata for ${rule.path}:`, error);
            return rule;
          }
        })
      );

      rulesWithMetadata.push(...batchResults);
    }

    return rulesWithMetadata;
  }

  /**
   * Parse minimal metadata from YAML (without full parsing)
   */
  private parseRuleMetadata(yaml: string): {
    title?: string;
    level?: string;
    description?: string;
    tags?: string[];
  } {
    const lines = yaml.split('\n');
    const metadata: any = {};

    for (const line of lines) {
      if (line.startsWith('title:')) {
        metadata.title = line.replace('title:', '').trim();
      } else if (line.startsWith('level:')) {
        metadata.level = line.replace('level:', '').trim();
      } else if (line.startsWith('description:')) {
        metadata.description = line.replace('description:', '').trim();
      } else if (line.startsWith('tags:')) {
        // Parse tags array (simplified)
        const tagsMatch = yaml.match(/tags:\s*\n((?:\s*-\s*.+\n?)+)/);
        if (tagsMatch) {
          metadata.tags = tagsMatch[1]
            .split('\n')
            .map((t) => t.trim().replace(/^-\s*/, ''))
            .filter((t) => t.length > 0);
        }
      }
    }

    return metadata;
  }

  /**
   * Search rules by query (title, description, tags)
   */
  async searchRules(query: string, categoryFilter?: string): Promise<SigmaRuleMetadata[]> {
    const cacheKey = `sigma:cache:search:${query}:${categoryFilter || 'all'}`;

    // Try cache first
    try {
      const cached = await cacheGet(cacheKey);
      if (cached) {
        console.log(`[SigmaHQ] Using cached search results for: ${query}`);
        return JSON.parse(cached);
      }
    } catch (error) {
      console.warn('[SigmaHQ] Redis cache error, fetching from GitHub:', error);
    }

    // Get all rules (or filtered by category)
    const allRules = categoryFilter
      ? await this.fetchRulesByCategory(categoryFilter)
      : await this.fetchAllRules();

    const searchTerms = query.toLowerCase().split(/\s+/);

    // Filter rules by query (search in name only for now - fast)
    const matchingRules = allRules.filter((rule) => {
      const ruleName = rule.name.toLowerCase();
      return searchTerms.some((term) => ruleName.includes(term));
    });

    // Fetch metadata for matching rules
    const results: SigmaRuleMetadata[] = [];

    const batchSize = 20;
    for (let i = 0; i < matchingRules.length && i < 100; i += batchSize) {
      const batch = matchingRules.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (rule) => {
          try {
            const yaml = await this.fetchRule(rule.downloadUrl);
            const metadata = this.parseRuleMetadata(yaml);

            return {
              ...rule,
              title: metadata.title,
              level: metadata.level,
              description: metadata.description,
              tags: metadata.tags,
            };
          } catch (error) {
            console.warn(`[SigmaHQ] Failed to fetch metadata for ${rule.path}:`, error);
            return rule;
          }
        })
      );

      results.push(...batchResults);
    }

    // Cache the result (shorter TTL for search results)
    try {
      await cacheSet(cacheKey, 1800, JSON.stringify(results)); // 30 minutes
    } catch (error) {
      console.warn('[SigmaHQ] Failed to cache search results:', error);
    }

    return results;
  }
}

// Export singleton instance
export const sigmahqClient = new SigmaHQClient(process.env.GITHUB_TOKEN);
