/** Recall snippets may end in the middle of a JSON event. Show its text, never raw JSON chrome. */
export function hitText(snippet: string): string {
    if (!snippet.trimStart().startsWith('{'))
        return snippet;
    for (const field of ['decision', 'skill_name', 'pattern']) {
        const match = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`).exec(snippet);
        if (match) {
            try {
                return JSON.parse(`"${match[1].replace(/\\$/, '')}"`) as string;
            }
            catch { /* use the original snippet */ }
        }
    }
    return snippet;
}
