import { ACTIONS, RESOURCES, ROLES, actionsFor, type Action } from '@sugrpay/shared';
import { ROLE_LABELS } from './role-labels';

const ACTION_LETTER: Record<Action, string> = {
  READ: 'R',
  WRITE: 'W',
  DELETE: 'D',
  APPROVE: 'A',
};

/**
 * Read-only view of the permission matrix (FRS-001 §3.3) — every cell is
 * computed straight from @sugrpay/shared, nothing is fetched. The matrix is a
 * fixed business rule, not user-editable data (see the design note in
 * domain/roles.ts): this panel exists so an admin can see exactly what a role
 * can do before assigning it, not to let anyone change it.
 */
export function RolesMatrix() {
  return (
    <div className="overflow-x-auto rounded-2xl border border-[#E5E7EB]">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-[#E5E7EB] bg-surface-muted text-left">
            <th className="px-4 py-2.5 font-semibold text-ink-strong">Resource</th>
            {ROLES.map((role) => (
              <th key={role} className="px-4 py-2.5 text-center font-semibold text-ink-strong">
                {ROLE_LABELS[role]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {RESOURCES.map((resource) => (
            <tr key={resource} className="border-b border-[#E5E7EB] last:border-0">
              <td className="px-4 py-2 font-medium text-ink-strong">{formatResource(resource)}</td>
              {ROLES.map((role) => {
                const actions = actionsFor(role, resource);
                const letters = ACTIONS.filter((action) => actions.has(action))
                  .map((action) => ACTION_LETTER[action])
                  .join('');
                return (
                  <td key={role} className="px-4 py-2 text-center text-ink-muted">
                    {letters || '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-[#E5E7EB] px-4 py-2.5 text-xs text-ink-muted">
        R = read, W = create/update, D = delete/void, A = approve.
      </p>
    </div>
  );
}

function formatResource(resource: string): string {
  return resource
    .toLowerCase()
    .split('_')
    .map((word) => (word[0] ?? '').toUpperCase() + word.slice(1))
    .join(' ');
}
