import { useEffect, useState } from 'react'
import type { ProjectInfo, SessionSummary } from '../../../shared/types'

interface SidebarGroup {
  id: string
  name: string
  sessionPaths: string[]
}

interface SidebarLibrary {
  projects: ProjectInfo[]
  groups: SidebarGroup[]
}

const STORAGE_KEY = 'pi-desktop:sidebar-library'

function readLibrary(): SidebarLibrary {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const stored = JSON.parse(raw) as SidebarLibrary
      if (Array.isArray(stored.projects) && Array.isArray(stored.groups)) {
        return stored
      }
    }
  } catch {
    // Start with an empty library if the stored preferences cannot be read.
  }
  return { projects: [], groups: [] }
}

export function useSidebarLibrary(
  project: ProjectInfo | null,
  sessions: SessionSummary[]
) {
  const [library, setLibrary] = useState(readLibrary)
  const [otherSessions, setOtherSessions] = useState<Record<string, SessionSummary[]>>({})

  useEffect(() => {
    if (!project) return
    setLibrary((current) => current.projects.some(({ path }) => path === project.path)
      ? current
      : { ...current, projects: [...current.projects, project] })
  }, [project])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(library))
  }, [library])

  const activePath = project?.path
  useEffect(() => {
    let cancelled = false
    const paths = library.projects.map(({ path }) => path).filter((path) => path !== activePath)
    void Promise.all(paths.map(async (path): Promise<[string, SessionSummary[]]> => {
      try {
        return [path, await window.piDesktop.listSessions(path)]
      } catch {
        return [path, []]
      }
    })).then((entries) => {
      if (!cancelled) setOtherSessions(Object.fromEntries(entries))
    })
    return () => { cancelled = true }
  }, [activePath, library.projects])

  function createGroup(name: string): void {
    const group = { id: crypto.randomUUID(), name, sessionPaths: [] }
    setLibrary((current) => ({ ...current, groups: [...current.groups, group] }))
  }

  function moveSession(path: string, groupId?: string): void {
    setLibrary((current) => ({
      ...current,
      groups: current.groups.map((group) => ({
        ...group,
        sessionPaths: group.id === groupId
          ? [...new Set([...group.sessionPaths, path])]
          : group.sessionPaths.filter((sessionPath) => sessionPath !== path)
      }))
    }))
  }

  return {
    ...library,
    sessionsByProject: activePath
      ? { ...otherSessions, [activePath]: sessions }
      : otherSessions,
    createGroup,
    moveSession
  }
}
