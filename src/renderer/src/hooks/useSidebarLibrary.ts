import { useEffect, useState } from 'react'
import type { ProjectInfo, SessionSummary } from '../../../shared/types'

interface SidebarGroup {
  id: string
  name: string
  sessionPaths: string[]
  projectPaths?: string[]
}

export interface SidebarSession {
  session: SessionSummary
  sourceProject: ProjectInfo
}

interface SidebarLibrary {
  projects: ProjectInfo[]
  groups: SidebarGroup[]
  sessionNames: Record<string, string>
  pinnedSessions: string[]
  pinnedProjects: string[]
  unreadSessions: string[]
  archivedSessions: SidebarSession[]
  restoredSessions: string[]
}

const STORAGE_KEY = 'pi-desktop:sidebar-library'
const EMPTY_LIBRARY: SidebarLibrary = {
  projects: [], groups: [], sessionNames: {}, pinnedSessions: [], pinnedProjects: [],
  unreadSessions: [], archivedSessions: [], restoredSessions: []
}

function readLibrary(): SidebarLibrary {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const stored = JSON.parse(raw) as SidebarLibrary
      if (Array.isArray(stored.projects) && Array.isArray(stored.groups)) {
        return { ...EMPTY_LIBRARY, ...stored }
      }
    }
  } catch {
    // Start with an empty library if the stored preferences cannot be read.
  }
  return EMPTY_LIBRARY
}

export function useSidebarLibrary(
  project: ProjectInfo | null,
  sessions: SessionSummary[],
  unassignedWorkspace: ProjectInfo | null
) {
  const [library, setLibrary] = useState(readLibrary)
  const [otherSessions, setOtherSessions] = useState<Record<string, SessionSummary[]>>({})

  function addProject(project: ProjectInfo): void {
    setLibrary((current) => current.projects.some(({ path }) => path === project.path)
      ? current
      : { ...current, projects: [...current.projects, project] })
  }

  useEffect(() => {
    if (!project || project.isUnassigned) return
    addProject(project)
  }, [project])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(library))
  }, [library])

  const activePath = project?.path
  useEffect(() => {
    let cancelled = false
    const paths = library.projects.map(({ path }) => path)
    if (unassignedWorkspace) paths.push(unassignedWorkspace.path)
    const retainPaths = library.restoredSessions
    const excludePaths = library.archivedSessions.map(({ session }) => session.path)
    void Promise.all(paths.map(async (path): Promise<[string, SessionSummary[]]> => {
      try {
        if (path === activePath && !retainPaths.length && !excludePaths.length) return [path, []]
        return [path, await window.piDesktop.listSessions(path, { retainPaths, excludePaths })]
      } catch {
        return [path, []]
      }
    })).then((entries) => {
      if (!cancelled) setOtherSessions(Object.fromEntries(entries))
    })
    return () => { cancelled = true }
  }, [activePath, library.projects, library.restoredSessions, library.archivedSessions, unassignedWorkspace])

  function createGroup(name: string, member?: { path: string; type: 'session' | 'project' }): void {
    const group = {
      id: crypto.randomUUID(),
      name,
      sessionPaths: member?.type === 'session' ? [member.path] : [],
      projectPaths: member?.type === 'project' ? [member.path] : []
    }
    setLibrary((current) => ({
      ...current,
      groups: [...(member ? current.groups.map((section) => ({
        ...section,
        sessionPaths: member.type === 'session'
          ? section.sessionPaths.filter((path) => path !== member.path) : section.sessionPaths,
        projectPaths: member.type === 'project'
          ? section.projectPaths?.filter((path) => path !== member.path) : section.projectPaths
      })) : current.groups), group]
    }))
  }

  function editGroup(id: string, name?: string): void {
    setLibrary((current) => ({
      ...current,
      groups: name
        ? current.groups.map((group) => group.id === id ? { ...group, name } : group)
        : current.groups.filter((group) => group.id !== id)
    }))
  }

  function reorderGroup(id: string, direction: -1 | 1): void {
    setLibrary((current) => {
      const groups = [...current.groups]
      const index = groups.findIndex((group) => group.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= groups.length) return current
      const [group] = groups.splice(index, 1)
      groups.splice(target, 0, group)
      return { ...current, groups }
    })
  }

  function renameProject(path: string, name: string): void {
    setLibrary((current) => ({
      ...current,
      projects: current.projects.map((item) => item.path === path ? { ...item, name } : item)
    }))
  }

  function moveProject(path: string, groupId?: string): void {
    setLibrary((current) => ({
      ...current,
      groups: current.groups.map((group) => ({
        ...group,
        projectPaths: group.id === groupId
          ? [...new Set([...(group.projectPaths ?? []), path])]
          : group.projectPaths?.filter((projectPath) => projectPath !== path)
      }))
    }))
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

  function renameSession(path: string, name?: string): void {
    setLibrary((current) => {
      const sessionNames = { ...current.sessionNames }
      if (name) sessionNames[path] = name
      else delete sessionNames[path]
      return { ...current, sessionNames }
    })
  }

  function togglePin(path: string, key: 'pinnedSessions' | 'pinnedProjects'): void {
    setLibrary((current) => ({
      ...current,
      [key]: current[key].includes(path)
        ? current[key].filter((item) => item !== path)
        : [...current[key], path]
    }))
  }

  function setSessionUnread(path: string, unread: boolean): void {
    setLibrary((current) => {
      if (current.unreadSessions.includes(path) === unread) return current
      return {
        ...current,
        unreadSessions: unread
          ? [...current.unreadSessions, path]
          : current.unreadSessions.filter((item) => item !== path)
      }
    })
  }

  function archiveSessions(items: SidebarSession[]): void {
    setLibrary((current) => {
      const entries = new Map(current.archivedSessions.map((item) => [item.session.path, item]))
      for (const item of items) entries.set(item.session.path, item)
      return { ...current, archivedSessions: [...entries.values()] }
    })
  }

  function restoreSession(path: string): void {
    setLibrary((current) => {
      const archived = current.archivedSessions.find((item) => item.session.path === path)
      if (!archived) return current
      const source = archived.sourceProject
      return {
        ...current,
        projects: source.isUnassigned || current.projects.some((project) => project.path === source.path)
          ? current.projects : [...current.projects, source],
        archivedSessions: current.archivedSessions.filter((item) => item.session.path !== path),
        restoredSessions: [...new Set([...current.restoredSessions, path])]
      }
    })
  }

  function replaceSession(previous: SidebarSession, next: SidebarSession): void {
    const oldPath = previous.session.path
    const newPath = next.session.path
    setOtherSessions((current) => {
      const old = (current[previous.sourceProject.path] ?? []).filter((item) => item.path !== oldPath)
      const updated = (current[next.sourceProject.path] ?? []).filter((item) => item.path !== newPath)
      return {
        ...current,
        [previous.sourceProject.path]: old,
        [next.sourceProject.path]: [next.session, ...updated]
      }
    })
    setLibrary((current) => {
      const replacePath = (path: string): string => path === oldPath ? newPath : path
      const sessionNames = { ...current.sessionNames }
      if (sessionNames[oldPath]) {
        sessionNames[newPath] = sessionNames[oldPath]
        delete sessionNames[oldPath]
      }
      return {
        ...current,
        sessionNames,
        groups: current.groups.map((group) => ({ ...group, sessionPaths: group.sessionPaths.map(replacePath) })),
        pinnedSessions: current.pinnedSessions.map(replacePath),
        unreadSessions: current.unreadSessions.map(replacePath),
        archivedSessions: current.archivedSessions.map((item) => item.session.path === oldPath ? next : item),
        restoredSessions: [...new Set([...current.restoredSessions.map(replacePath), newPath])]
      }
    })
  }

  function removeSession(path: string, projectPath: string): void {
    setOtherSessions((current) => ({
      ...current,
      [projectPath]: (current[projectPath] ?? []).filter((session) => session.path !== path)
    }))
    moveSession(path)
    setLibrary((current) => {
      const sessionNames = { ...current.sessionNames }
      delete sessionNames[path]
      return {
        ...current,
        sessionNames,
        pinnedSessions: current.pinnedSessions.filter((item) => item !== path),
        unreadSessions: current.unreadSessions.filter((item) => item !== path),
        archivedSessions: current.archivedSessions.filter((item) => item.session.path !== path),
        restoredSessions: current.restoredSessions.filter((item) => item !== path)
      }
    })
  }

  function removeProject(path: string): void {
    moveProject(path)
    setLibrary((current) => ({
      ...current,
      projects: current.projects.filter((item) => item.path !== path),
      pinnedProjects: current.pinnedProjects.filter((item) => item !== path)
    }))
  }

  return {
    ...library,
    unassignedWorkspace,
    sessionsByProject: activePath
      ? {
        ...otherSessions,
        [activePath]: [...sessions, ...(otherSessions[activePath] ?? []).filter((item) =>
          sessions.every((session) => session.path !== item.path))]
      }
      : otherSessions,
    createGroup,
    editGroup,
    reorderGroup,
    addProject,
    moveSession,
    moveProject,
    renameProject,
    renameSession,
    togglePin,
    setSessionUnread,
    archiveSessions,
    restoreSession,
    replaceSession,
    removeSession,
    removeProject
  }
}
