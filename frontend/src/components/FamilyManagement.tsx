import { useCallback, useEffect, useState } from "react";
import {
  cancelFamilyInvitation,
  createFamilyInvitation,
  getFamilyInvitations,
  getFamilyMembers,
  getMyFamily,
  removeFamilyMember,
  updateFamilyMemberRole,
} from "../lib/api";
import type { FamilyInvitationItem, FamilyMemberItem, FamilySummary, InvitableFamilyRole } from "../types";
import "./FamilyManagement.css";
import ConfirmSheet from "./ConfirmSheet";
import { userFacingError } from "../lib/userFacingError";

const ROLE_LABELS: Record<string, string> = {
  owner: "소유자",
  admin: "관리자",
  member: "구성원",
  viewer: "열람자",
};

const INVITE_ROLES: { value: InvitableFamilyRole; label: string }[] = [
  { value: "member", label: "구성원" },
  { value: "admin", label: "관리자" },
  { value: "viewer", label: "열람자" },
];

const STATUS_LABELS: Record<string, string> = {
  pending: "대기 중",
  accepted: "수락됨",
  revoked: "취소됨",
  expired: "만료됨",
};

function canManageFamily(role: string): boolean {
  return role === "owner" || role === "admin";
}

export default function FamilyManagement() {
  const [family, setFamily] = useState<FamilySummary | null>(null);
  // 내보내기 전 물음 — window.confirm 을 쓰지 않는다(§11).
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [members, setMembers] = useState<FamilyMemberItem[]>([]);
  const [invitations, setInvitations] = useState<FamilyInvitationItem[]>([]);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InvitableFamilyRole>("member");
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const summary = await getMyFamily();
      setFamily(summary);
      const [memberRows, invitationRows] = await Promise.all([
        getFamilyMembers(summary.family_id),
        canManageFamily(summary.role) ? getFamilyInvitations(summary.family_id) : Promise.resolve([]),
      ]);
      setMembers(memberRows);
      setInvitations(invitationRows);
    } catch (err) {
      setError(userFacingError(err, "가족 정보를 불러오지 못했어요."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!family) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createFamilyInvitation(family.family_id, email.trim(), inviteRole);
      setLastInviteUrl(result.invite_url);
      setEmail("");
      await load();
    } catch (err) {
      setError(userFacingError(err, "초대를 만들지 못했어요."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("링크를 복사하지 못했어요.");
    }
  };

  const handleRoleChange = async (memberId: string, role: InvitableFamilyRole) => {
    if (!family) return;
    try {
      await updateFamilyMemberRole(family.family_id, memberId, role);
      await load();
    } catch (err) {
      setError(userFacingError(err, "역할을 바꾸지 못했어요."));
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!family) return;
    try {
      await removeFamilyMember(family.family_id, memberId);
      await load();
    } catch (err) {
      setError(userFacingError(err, "구성원을 제거하지 못했어요."));
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    if (!family) return;
    try {
      await cancelFamilyInvitation(family.family_id, invitationId);
      await load();
    } catch (err) {
      setError(userFacingError(err, "초대를 취소하지 못했어요."));
    }
  };

  if (loading) {
    return <p className="notice notice--progress family-panel__notice" role="status">가족 정보를 불러오는 중...</p>;
  }

  if (!family) {
    return <p className={`notice notice--${error ? "error" : "info"} family-panel__notice`} role={error ? "alert" : undefined}>{error || "가족 정보가 없어요."}</p>;
  }

  const manager = canManageFamily(family.role);

  return (
    <div className="family-panel">
      <header className="family-panel__header">
        <h2>{family.name}</h2>
        <p>내 역할: {ROLE_LABELS[family.role] || family.role}</p>
      </header>

      {error && <p className="notice notice--error family-panel__error" role="alert">{error}</p>}

      {manager && (
        <section className="family-panel__section">
          <h3>가족 초대</h3>
          <form className="family-invite-form" onSubmit={handleInvite}>
            <label className="field">
              <span className="field__label">이메일</span>
              <input
                className="field__input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="family@example.com"
                required
              />
            </label>
            <label className="field">
              <span className="field__label">역할</span>
              <select
                className="field__input"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as InvitableFamilyRole)}
              >
                {INVITE_ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="upload-form__submit" type="submit" disabled={submitting}>
              {submitting ? "초대 만드는 중..." : "초대 링크 만들기"}
            </button>
          </form>
          {lastInviteUrl && (
            <div className="invite-link-box">
              <p>방금 만든 초대 링크</p>
              <code>{lastInviteUrl}</code>
              <button type="button" className="btn btn--secondary" onClick={() => handleCopy(lastInviteUrl)}>
                {copied ? "복사됨 ✓" : "링크 복사"}
              </button>
            </div>
          )}
        </section>
      )}

      <section className="family-panel__section">
        <h3>구성원 ({members.length})</h3>
        <ul className="member-list">
          {members.map((member) => (
            <li key={member.id} className="member-card">
              <div>
                <strong>{member.display_name}</strong>
                <span className="member-card__role">{ROLE_LABELS[member.role] || member.role}</span>
              </div>
              {manager && member.role !== "owner" && (
                <div className="member-card__actions">
                  <select
                    className="field__input field__input--compact"
                    value={member.role}
                    onChange={(e) => handleRoleChange(member.id, e.target.value as InvitableFamilyRole)}
                  >
                    {INVITE_ROLES.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="member-card__remove" onClick={() => setPendingRemoveId(member.id)}>
                    제거
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {manager && (
        <section className="family-panel__section">
          <h3>초대 현황</h3>
          {invitations.length === 0 ? (
            <p className="notice notice--info family-panel__notice">보낸 초대가 없어요.</p>
          ) : (
            <ul className="invitation-list">
              {invitations.map((invitation) => (
                <li key={invitation.id} className="invitation-card">
                  <div>
                    <strong>{invitation.invitee_email}</strong>
                    <span>{ROLE_LABELS[invitation.role]}</span>
                    <span className={`invitation-card__status invitation-card__status--${invitation.status}`}>
                      {STATUS_LABELS[invitation.status] || invitation.status}
                    </span>
                  </div>
                  {invitation.status === "pending" && (
                    <button type="button" className="member-card__remove" onClick={() => handleCancelInvitation(invitation.id)}>
                      취소
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <a className="btn btn--ghost family-panel__back" href="/">
        앨범 만들기로 돌아가기
      </a>
      {pendingRemoveId ? (
        <ConfirmSheet
          title="이 구성원을 가족에서 내보낼까요?"
          description="내보내도 그 사람이 앨범에 남긴 사진과 글은 그대로 있어요."
          confirmLabel="내보내기"
          onConfirm={() => { const target = pendingRemoveId; setPendingRemoveId(null); void handleRemoveMember(target); }}
          onCancel={() => setPendingRemoveId(null)}
        />
      ) : null}
    </div>
  );
}
