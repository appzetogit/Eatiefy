import { Link } from "react-router-dom"
import { ShieldAlert } from "lucide-react"
import { useAdminPermissions } from "@food/hooks/useAdminPermissions"

/**
 * Page-level guard for create/edit screens that can be reached by URL.
 * Hiding the "Add" button is not enough: a sub-admin without the permission
 * could still open the form directly. Full admins always pass.
 *
 *   <RequireAdminAction action="create" backTo="/admin/food/restaurants">
 *     <AddRestaurant />
 *   </RequireAdminAction>
 */
export default function RequireAdminAction({ action = "edit", backTo = "/admin/food", children }) {
  const { can } = useAdminPermissions()

  if (can(action)) return children

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-amber-500" />
        <h2 className="text-lg font-semibold text-slate-900">Permission required</h2>
        <p className="mt-2 text-sm text-slate-600">
          You don&apos;t have permission to {action} in this section. Ask a full admin to grant it.
        </p>
        <Link
          to={backTo}
          className="mt-5 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Go back
        </Link>
      </div>
    </div>
  )
}
