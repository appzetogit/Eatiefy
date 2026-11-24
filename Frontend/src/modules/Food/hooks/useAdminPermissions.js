import { useLocation } from "react-router-dom"
import { useMemo, useCallback } from "react"
import { getCurrentUser } from "@food/utils/auth"
import {
  hasPermission,
  isFullAdmin,
  isSubAdmin,
} from "@food/utils/subAdminPermissions"

/**
 * Hook to check granular permissions (view, create, edit, delete)
 * for the current admin or sub-admin.
 *
 * Full ADMIN always returns true for all actions.
 * SUB_ADMIN checks against assigned module permissions.
 */
export function useAdminPermissions(defaultPathOrKey) {
  const location = useLocation()
  const user = getCurrentUser("admin")
  const isFull = isFullAdmin(user)
  const isSub = isSubAdmin(user)

  const currentTarget = defaultPathOrKey || location.pathname

  const check = useCallback(
    (action = "view", pathOrKey = currentTarget) => {
      return hasPermission(user, pathOrKey, action)
    },
    [user, currentTarget]
  )

  const canView = useMemo(() => check("view"), [check])
  const canCreate = useMemo(() => check("create"), [check])
  const canEdit = useMemo(() => check("edit"), [check])
  const canDelete = useMemo(() => check("delete"), [check])

  return {
    user,
    isFullAdmin: isFull,
    isSubAdmin: isSub,
    can: check,
    checkPermission: check,
    canView,
    canCreate,
    canEdit,
    canDelete,
  }
}

export default useAdminPermissions
