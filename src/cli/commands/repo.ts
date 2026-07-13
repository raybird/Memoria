import path from 'node:path'
import type { Command } from 'commander'
import type { MemoriaCore } from '../../core/index.js'

function shortSha(sha?: string): string {
    return sha ? sha.slice(0, 8) : '-'
}

export function registerRepoCommand(program: Command, core: MemoriaCore): void {
    const repoCommand = program
        .command('repo')
        .description('Manage git repositories observed by Memoria (read-only scanning)')

    repoCommand
        .command('add')
        .description('Register a local git repository for observation')
        .argument('<path>', 'Path inside the git repository')
        .option('--name <name>', 'Display name (defaults to the repository directory name)')
        .option('--default-branch <branch>', 'Override the detected default branch')
        .option('--scan-history', 'Scan full history on first sync (Phase 2)')
        .option('--history-limit <n>', 'Cap the initial history scan (Phase 2)')
        .option('--json', 'Machine-readable JSON output')
        .action(async (repoPath: string, options: {
            name?: string; defaultBranch?: string; scanHistory?: boolean; historyLimit?: string; json?: boolean
        }) => {
            const historyLimit = options.historyLimit === undefined ? undefined : Number(options.historyLimit)
            if (historyLimit !== undefined && (!Number.isFinite(historyLimit) || historyLimit <= 0)) {
                throw new Error(`Invalid --history-limit '${options.historyLimit}'. Use a positive number`)
            }
            const result = await core.repoAdd({
                path: path.resolve(repoPath),
                name: options.name,
                defaultBranch: options.defaultBranch,
                scanHistory: options.scanHistory,
                historyLimit
            })
            if (!result.ok) throw new Error(result.error)
            if (options.json) {
                console.log(JSON.stringify(result))
            } else {
                const d = result.data!
                console.log(`${d.created ? '✓ 已註冊 repository' : '✓ repository 已存在（更新狀態）'}: ${d.repository.id}`)
                console.log(`- name: ${d.repository.name}`)
                console.log(`- path: ${d.instance.local_path}`)
                console.log(`- branch: ${d.worktree.current_branch ?? '(detached)'} @ ${shortSha(d.worktree.current_head_sha)}`)
                console.log(`- status: ${d.repository.status}`)
                if (d.initial_scan) {
                    console.log(`- initial scan: commits=${d.initial_scan.new_commits} refs=${d.initial_scan.new_refs} tags=${d.initial_scan.new_tags}`)
                    for (const warning of d.initial_scan.warnings) console.log(`  ⚠ ${warning}`)
                }
            }
        })

    repoCommand
        .command('sync')
        .description('Incrementally scan a repository for new commits, refs, and tags')
        .argument('<repository>', 'Repository id, name, or local path')
        .option('--dry-run', 'Report what would be recorded without writing anything')
        .option('--json', 'Machine-readable JSON output')
        .action(async (ref: string, options: { dryRun?: boolean; json?: boolean }) => {
            const result = await core.repoSync(ref, { dryRun: options.dryRun })
            if (!result.ok) throw new Error(result.error)
            if (options.json) {
                console.log(JSON.stringify(result))
            } else {
                const d = result.data!
                console.log(`✓ sync ${d.dry_run ? '(dry-run) ' : ''}完成: ${d.repository_id} (${d.scan_run_id})`)
                console.log(`- head: ${shortSha(d.previous_head)} → ${shortSha(d.current_head)}`)
                console.log(`- new: commits=${d.new_commits} refs=${d.new_refs} tags=${d.new_tags} events=${d.events_created}`)
                if (d.dry_run) {
                    for (const event of d.dry_run.events) console.log(`  · would create event: ${event.type}${event.ref ? ` (${event.ref})` : ''}`)
                }
                for (const warning of d.warnings) console.log(`  ⚠ ${warning}`)
            }
        })

    repoCommand
        .command('list')
        .description('List repositories registered with Memoria')
        .option('--json', 'Machine-readable JSON output')
        .action(async (options: { json?: boolean }) => {
            const result = await core.repoList()
            if (!result.ok) throw new Error(result.error)
            if (options.json) {
                console.log(JSON.stringify(result))
            } else {
                const items = result.data ?? []
                console.log(`📦 Repositories: ${items.length}`)
                for (const item of items) {
                    const parts = [
                        `${item.repository.id}: ${item.repository.name}`,
                        `path=${item.instance?.local_path ?? '-'}`,
                        `branch=${item.worktree?.current_branch ?? '-'}`,
                        `head=${shortSha(item.worktree?.current_head_sha)}`,
                        `last_scan=${item.worktree?.last_scanned_at ?? 'never'}`,
                        `status=${item.repository.status}`
                    ]
                    console.log(`- ${parts.join(' | ')}`)
                }
            }
        })

    repoCommand
        .command('status')
        .description('Show registry + live git state of a repository')
        .argument('<repository>', 'Repository id, name, or local path')
        .option('--json', 'Machine-readable JSON output')
        .action(async (ref: string, options: { json?: boolean }) => {
            const result = await core.repoStatus(ref)
            if (!result.ok) throw new Error(result.error)
            if (options.json) {
                console.log(JSON.stringify(result))
            } else {
                const d = result.data!
                console.log(`📦 ${d.repository.name} (${d.repository.id})`)
                console.log(`- status: ${d.repository.status}`)
                console.log(`- remote: ${d.repository.normalized_remote_url ?? '-'}`)
                console.log(`- root commit: ${shortSha(d.repository.root_commit_sha)}`)
                console.log(`- default branch: ${d.repository.default_branch ?? '-'}`)
                console.log(`- path: ${d.instance?.local_path ?? '-'} (available=${d.instance?.is_available ?? false})`)
                console.log(`- last observed: ${d.worktree?.current_branch ?? '-'} @ ${shortSha(d.worktree?.current_head_sha)} | last_scan=${d.worktree?.last_scanned_at ?? 'never'}`)
                if (d.live) {
                    console.log(`- live: ${d.live.current_branch ?? '(detached)'} @ ${shortSha(d.live.head_sha)} | dirty=${d.live.working_tree_dirty} | head_moved=${d.live.head_moved_since_last_seen}${d.live.is_shallow ? ' | shallow' : ''}`)
                } else {
                    console.log('- live: unavailable (path missing or not a git repository — use `repo relocate`)')
                }
            }
        })

    repoCommand
        .command('relocate')
        .description('Re-bind a repository to a new local path (same history required)')
        .argument('<repository>', 'Repository id, name, or old local path')
        .argument('<new-path>', 'New local path of the clone')
        .option('--json', 'Machine-readable JSON output')
        .action(async (ref: string, newPath: string, options: { json?: boolean }) => {
            const result = await core.repoRelocate(ref, path.resolve(newPath))
            if (!result.ok) throw new Error(result.error)
            if (options.json) {
                console.log(JSON.stringify(result))
            } else {
                const d = result.data!
                console.log(`✓ 已重新綁定: ${d.repository.id}`)
                console.log(`- path: ${d.instance?.local_path}`)
            }
        })

    repoCommand
        .command('remove')
        .description('Stop observing a repository (memories/summaries kept unless flags say otherwise)')
        .argument('<repository>', 'Repository id, name, or local path')
        .option('--delete-observations', 'Also delete raw git observations (commits/refs/events/scan runs)')
        .option('--delete-summaries', 'Also delete generated summaries and checkpoints')
        .option('--delete-memories', 'Also delete promoted memories (must be explicit)')
        .option('--json', 'Machine-readable JSON output')
        .action(async (ref: string, options: {
            deleteObservations?: boolean; deleteSummaries?: boolean; deleteMemories?: boolean; json?: boolean
        }) => {
            const result = await core.repoRemove(ref, {
                deleteObservations: options.deleteObservations,
                deleteSummaries: options.deleteSummaries,
                deleteMemories: options.deleteMemories
            })
            if (!result.ok) throw new Error(result.error)
            if (options.json) {
                console.log(JSON.stringify(result))
            } else {
                const d = result.data!
                console.log(`✓ 已停止掃描: ${d.repository_id} (status=${d.status})`)
                console.log(`- deleted: observations=${d.deleted.observations} summaries=${d.deleted.summaries} memories=${d.deleted.memories}`)
            }
        })
}
