import { useCallback, useState } from 'react'

const SIDEBAR_KEY = 'silo-sidebar-collapsed'

function readInitialCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SIDEBAR_KEY) === 'true'
}

export function useSidebarPreference(): {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
} {
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(readInitialCollapsed)

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed
      window.localStorage.setItem(SIDEBAR_KEY, String(next))
      return next
    })
  }, [])

  return { sidebarCollapsed, toggleSidebar }
}
