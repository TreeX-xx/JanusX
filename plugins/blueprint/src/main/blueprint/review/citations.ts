import type { ReviewResult } from '../../../shared/blueprint-review'

/** Line endings are transport details; all other source characters remain exact. */
export function containsReviewQuote(content: string, quote: string): boolean {
  return content.replaceAll('\r\n', '\n').includes(quote.replaceAll('\r\n', '\n'))
}

export function validateReviewCitations(result: ReviewResult, materials: Array<{ path: string; content: string }>): void {
  for (const finding of [...result.findings, ...result.resolvedFindings]) {
    for (const citation of finding.citations) {
      const material = materials.find(material => material.path === citation.path)
      if (!material) throw Object.assign(new Error('Citation source was not read: ' + citation.path), { code: 'REVIEW_OUTPUT_INVALID' })
      if (!containsReviewQuote(material.content, citation.quote)) {
        throw Object.assign(new Error('Citation quote does not match the read source: ' + citation.path), { code: 'REVIEW_OUTPUT_INVALID' })
      }
    }
  }
}
