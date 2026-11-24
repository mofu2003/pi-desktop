import { useCallback, useEffect, useState } from 'react'
import type { AvailableUpdate } from '../../../shared/types'

export interface UseUpdateResult {
  update: AvailableUpdate | null
  isOpening: boolean
  openUpdate: () => Promise<void>
}

export function useUpdate(): UseUpdateResult {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null)
  const [isOpening, setIsOpening] = useState(false)

  useEffect(() => {
    let isActive = true
    void window.piDesktop
      .getUpdate()
      .then((available) => {
        if (isActive && available) setUpdate(available)
      })
      .catch(() => {
        // A failed check simply leaves the button hidden.
      })
    const unsubscribe = window.piDesktop.onUpdateAvailable((available) => {
      setUpdate(available)
    })
    return () => {
      isActive = false
      unsubscribe()
    }
  }, [])

  const openUpdate = useCallback(async (): Promise<void> => {
    setIsOpening(true)
    try {
      await window.piDesktop.openUpdate()
    } finally {
      setIsOpening(false)
    }
  }, [])

  return { update, isOpening, openUpdate }
}
