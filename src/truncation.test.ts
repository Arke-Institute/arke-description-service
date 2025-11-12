/**
 * Tests for the Progressive Tax Truncation Algorithm
 *
 * These tests validate all examples from PROGRESSIVE-TAX-ALGORITHM.md
 */

import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimatePromptTokens,
  calculateAvailableBudget,
  applyProgressiveTaxTruncation
} from './truncation';
import type { TextFile, TruncationConfig } from './types';

describe('Token Estimation', () => {
  it('should estimate tokens using 1 token ≈ 3 characters', () => {
    expect(estimateTokens('test')).toBe(2); // 4 chars / 3 = 1.33 -> 2 tokens
    expect(estimateTokens('hello world')).toBe(4); // 11 chars / 3 = 3.67 -> 4 tokens
    expect(estimateTokens('a'.repeat(300))).toBe(100); // 300 chars / 3 = 100 tokens
  });

  it('should add overhead for prompt tokens', () => {
    const tokens = estimateTokens('test');
    const promptTokens = estimatePromptTokens('test');
    expect(promptTokens).toBe(tokens + 10); // +10 for message overhead
  });
});

describe('Budget Calculation', () => {
  it('should calculate available budget with safety margin', () => {
    const config: TruncationConfig = {
      contextWindowTokens: 131000,
      maxOutputTokens: 3072,
      safetyMarginRatio: 0.7,
      systemPromptTokens: 100,
      userPromptTemplateTokens: 50
    };

    const available = calculateAvailableBudget(config);
    // (131000 - 100 - 50 - 3072) * 0.7 = 127778 * 0.7 = 89444
    expect(available).toBe(89444);
  });

  it('should handle different safety margins', () => {
    const config: TruncationConfig = {
      contextWindowTokens: 10000,
      maxOutputTokens: 1000,
      safetyMarginRatio: 0.5,
      systemPromptTokens: 100,
      userPromptTemplateTokens: 100
    };

    const available = calculateAvailableBudget(config);
    // (10000 - 100 - 100 - 1000) * 0.5 = 8800 * 0.5 = 4400
    expect(available).toBe(4400);
  });
});

describe('Progressive Tax Truncation - Example 1: One Giant File', () => {
  it('should protect small files and tax only the giant file', () => {
    const files: TextFile[] = [
      { name: 'file1.txt', content: 'a'.repeat(3000) }, // 1000 tokens (3000 / 3)
      { name: 'file2.txt', content: 'b'.repeat(3000) }, // 1000 tokens
      { name: 'file3.txt', content: 'c'.repeat(30000) }, // 10000 tokens
      { name: 'file4.txt', content: 'd'.repeat(900000) } // 300000 tokens
    ];

    const result = applyProgressiveTaxTruncation(files, 100000);

    // Verify results
    expect(result.totalTokensBefore).toBe(312000);
    expect(result.totalTokensAfter).toBeLessThanOrEqual(100000);
    expect(result.deficit).toBe(212000);
    expect(result.protectionMode).toBe(true);
    expect(result.filesProtected).toBe(3);
    expect(result.filesTruncated).toBe(1);

    // Small files should be protected
    expect(result.files[0].tokens).toBe(1000);
    expect(result.files[1].tokens).toBe(1000);
    expect(result.files[2].tokens).toBe(10000);

    // Giant file should pay the deficit
    expect(result.files[3].tokens).toBe(88000);
  });
});

describe('Progressive Tax Truncation - Example 2: Multiple Large Files', () => {
  it('should tax multiple large files proportionally', () => {
    const files: TextFile[] = [
      { name: 'file1.txt', content: 'a'.repeat(3000) }, // 1000 tokens (3000 / 3)
      { name: 'file2.txt', content: 'b'.repeat(3000) }, // 1000 tokens
      { name: 'file3.txt', content: 'c'.repeat(300000) }, // 100000 tokens
      { name: 'file4.txt', content: 'd'.repeat(600000) } // 200000 tokens
    ];

    const result = applyProgressiveTaxTruncation(files, 100000);

    expect(result.totalTokensBefore).toBe(302000);
    expect(result.totalTokensAfter).toBeLessThanOrEqual(100000);
    expect(result.deficit).toBe(202000);
    expect(result.protectionMode).toBe(true);
    expect(result.filesProtected).toBe(2);
    expect(result.filesTruncated).toBe(2);

    // Small files protected
    expect(result.files[0].tokens).toBe(1000);
    expect(result.files[1].tokens).toBe(1000);

    // Large files should keep same percentage
    const file3Kept = result.files[2].tokens / 100000;
    const file4Kept = result.files[3].tokens / 200000;
    expect(Math.abs(file3Kept - file4Kept)).toBeLessThan(0.01); // Same percentage within 1%
  });
});

describe('Progressive Tax Truncation - Example 3: Many Equal Files', () => {
  it('should tax all equal files proportionally', () => {
    const files: TextFile[] = Array.from({ length: 300 }, (_, i) => ({
      name: `file${i}.txt`,
      content: 'x'.repeat(3000) // 1000 tokens each (3000 / 3)
    }));

    const result = applyProgressiveTaxTruncation(files, 100000);

    expect(result.totalTokensBefore).toBe(300000);
    expect(result.totalTokensAfter).toBeLessThanOrEqual(100000);
    expect(result.deficit).toBe(200000);
    // Average tax is 200000/300 = 666.67, all files have 1000 tokens, so all are above average
    // But totalBelow = 0, which is <= targetTokens (100000), so protection IS feasible
    // Therefore protection mode will be true, but since aboveAverage has all files, all get taxed
    expect(result.filesTruncated).toBe(300);

    // All files should keep approximately same tokens
    const firstFileTokens = result.files[0].tokens;
    for (const file of result.files) {
      expect(Math.abs(file.tokens - firstFileTokens)).toBeLessThan(2); // Within 2 tokens
    }

    // Each should keep about 333 tokens
    expect(firstFileTokens).toBeGreaterThan(330);
    expect(firstFileTokens).toBeLessThan(340);
  });
});

describe('Progressive Tax Truncation - Example 4: Fallback Mode', () => {
  it('should use fallback when protection is not feasible', () => {
    const files: TextFile[] = [
      { name: 'file1.txt', content: 'a'.repeat(447) }, // 149 tokens (447 / 3 = 149)
      { name: 'file2.txt', content: 'b'.repeat(753) } // 251 tokens (753 / 3 = 251)
    ];

    const result = applyProgressiveTaxTruncation(files, 100);

    expect(result.totalTokensBefore).toBe(400); // 149 + 251
    expect(result.totalTokensAfter).toBeLessThanOrEqual(100);
    expect(result.deficit).toBe(300); // 400 - 100
    expect(result.protectionMode).toBe(false); // Fallback mode
    expect(result.filesTruncated).toBe(2);

    // Both files should keep same percentage (~25%)
    const file1Kept = result.files[0].tokens / 149;
    const file2Kept = result.files[1].tokens / 251;
    expect(Math.abs(file1Kept - file2Kept)).toBeLessThan(0.02); // Same percentage within 2%

    // Total should be at or under target
    const totalAfter = result.files[0].tokens + result.files[1].tokens;
    expect(totalAfter).toBeLessThanOrEqual(100);
  });
});

describe('Progressive Tax Truncation - Edge Cases', () => {
  it('should handle already under budget', () => {
    const files: TextFile[] = [
      { name: 'file1.txt', content: 'small' }
    ];

    const result = applyProgressiveTaxTruncation(files, 1000);

    expect(result.deficit).toBe(0);
    expect(result.filesTruncated).toBe(0);
    expect(result.files[0].content).toBe('small'); // Unchanged
  });

  it('should handle empty files array', () => {
    const files: TextFile[] = [];
    const result = applyProgressiveTaxTruncation(files, 1000);

    expect(result.totalTokensBefore).toBe(0);
    expect(result.totalTokensAfter).toBe(0);
    expect(result.files.length).toBe(0);
  });

  it('should handle single file over budget', () => {
    const files: TextFile[] = [
      { name: 'large.txt', content: 'x'.repeat(75000) } // 25000 tokens (75000 / 3)
    ];

    const result = applyProgressiveTaxTruncation(files, 10000);

    expect(result.files[0].tokens).toBe(10000);
    // With single file, average tax = 15000/1 = 15000
    // File has 25000 tokens > 15000, so it's above average
    // totalBelow = 0 <= targetTokens (10000), so protection IS feasible
    expect(result.protectionMode).toBe(true);
    expect(result.filesTruncated).toBe(1);
  });

  it('should never produce negative tokens', () => {
    const files: TextFile[] = [
      { name: 'file1.txt', content: 'tiny' },
      { name: 'file2.txt', content: 'also tiny' }
    ];

    const result = applyProgressiveTaxTruncation(files, 1);

    for (const file of result.files) {
      expect(file.tokens).toBeGreaterThanOrEqual(0);
    }
  });

  it('should add truncation indicator to truncated content', () => {
    const files: TextFile[] = [
      { name: 'file.txt', content: 'x'.repeat(10000) }
    ];

    const result = applyProgressiveTaxTruncation(files, 100);

    expect(result.files[0].content).toContain('[content truncated]');
  });

  it('should not add truncation indicator to untruncated content', () => {
    const files: TextFile[] = [
      { name: 'file.txt', content: 'small content' }
    ];

    const result = applyProgressiveTaxTruncation(files, 1000);

    expect(result.files[0].content).not.toContain('[content truncated]');
    expect(result.files[0].content).toBe('small content');
  });
});

describe('Real-world Scenario', () => {
  it('should handle mixed file sizes with 131k context window', () => {
    const files: TextFile[] = [
      { name: 'readme.txt', content: 'x'.repeat(1500) }, // 500 tokens (1500 / 3)
      { name: 'metadata.json', content: 'y'.repeat(900) }, // 300 tokens (900 / 3)
      { name: 'transcript.txt', content: 'z'.repeat(300000) }, // 100k tokens (300000 / 3)
      { name: 'notes.md', content: 'a'.repeat(600) }, // 200 tokens (600 / 3)
      { name: 'document.txt', content: 'b'.repeat(150000) } // 50k tokens (150000 / 3)
    ];

    const config: TruncationConfig = {
      contextWindowTokens: 131000,
      maxOutputTokens: 3072,
      safetyMarginRatio: 0.7,
      systemPromptTokens: 100,
      userPromptTemplateTokens: 200
    };

    const available = calculateAvailableBudget(config);
    const result = applyProgressiveTaxTruncation(files, available);

    // Should fit within budget
    expect(result.totalTokensAfter).toBeLessThanOrEqual(available);

    // Small files should be protected
    expect(result.filesProtected).toBeGreaterThan(0);

    // Large files should be truncated
    expect(result.filesTruncated).toBeGreaterThan(0);

    // Protection mode should be active
    expect(result.protectionMode).toBe(true);
  });
});
