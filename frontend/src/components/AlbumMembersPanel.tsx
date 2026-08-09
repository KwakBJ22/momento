import { useEffect, useState } from "react";
import {
  addAlbumMember,
  getAlbumMembers,
  getFamilyMembers,
  getMyFamily,
  removeAlbumMember,
  updateAlbumMemberRole,
} from "../lib/api";
import type { AlbumMemberItem, AlbumMemberRole, FamilyMemberItem } from "../types";
import "./FamilyManagement.css";
import ConfirmSheet from "./ConfirmSheet";

const ALBUM_ROLE_LABELS: Record<AlbumMemberRole, string> = {
  owner: "소유자",
  editor: "편집자",
  contributor: "기여자",
  viewer: "열람자",
};

const ASSIGNABLE_ROLES: AlbumMemberRole[] = ["editor", "contributor", "viewer"];

interface AlbumMembersPanelProps {
  albumId: string;
}

export default function AlbumMembersPanel({ albumId }: AlbumMembersPanelProps) {
  const [members, setMembers] = useState<AlbumMemberItem[]>([]);
  // 내보내기 전 물음 — window.confirm 을 쓰지 않는다(§11).
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [familyMembers, setFamilyMembers] = useState<FamilyMemberItem[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [selectedRole, setSelectedRole] = useState<AlbumMemberRole>("contributor");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [albumMembers, family] = await Promise.all([getAlbumMembers(albumId), getMyFamily()]);
      const familyMemberRows = await getFamilyMembers(family.family_id);
      setMembers(albumMembers);
      setFamilyMembers(familyMemberRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "참여자 정보를 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [albumId]);

  const handleAdd = async () => {
    if (!selectedProfileId) return;
    try {
      await addAlbumMember(albumId, selectedProfileId, selectedRole);
      setSelectedProfileId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "참여자를 추가하지 못했어요.");
    }
  };

  const handleRoleChange = async (memberId: string, role: AlbumMemberRole) => {
    try {
      await updateAlbumMemberRole(albumId, memberId, role);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "역할을 바꾸지 못했어요.");
    }
  };

  const handleRemove = async (memberId: string) => {
    try {
      await removeAlbumMember(albumId, memberId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "참여자를 제거하지 못했어요.");
    }
  };

  const existingIds = new Set(members.map((member) => member.profile_id));
  const candidates = familyMembers.filter((member) => !existingIds.has(member.profile_id));

  if (loading) {
    return <p className="notice notice--progress family-panel__notice" role="status">참여자를 불러오는 중...</p>;
  }

  return (
    <section className="family-panel__section">
      <h3>앨범 참여자</h3>
      {error && <p className="notice notice--error family-panel__error" role="alert">{error}</p>}
      <ul className="member-list">
        {members.map((member) => (
          <li key={member.id} className="member-card">
            <div>
              <strong>{member.display_name}</strong>
              <span className="member-card__role">{ALBUM_ROLE_LABELS[member.role]}</span>
            </div>
            {member.role !== "owner" && (
              <div className="member-card__actions">
                <select
                  className="field__input field__input--compact"
                  value={member.role}
                  onChange={(e) => handleRoleChange(member.id, e.target.value as AlbumMemberRole)}
                >
                  {ASSIGNABLE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ALBUM_ROLE_LABELS[role]}
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
      {candidates.length > 0 && (
        <div className="family-invite-form">
          <label className="field">
            <span className="field__label">가족 구성원 추가</span>
            <select
              className="field__input"
              value={selectedProfileId}
              onChange={(e) => setSelectedProfileId(e.target.value)}
            >
              <option value="">선택...</option>
              {candidates.map((member) => (
                <option key={member.profile_id} value={member.profile_id}>
                  {member.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">역할</span>
            <select
              className="field__input"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as AlbumMemberRole)}
            >
              {ASSIGNABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ALBUM_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="upload-form__submit" onClick={handleAdd} disabled={!selectedProfileId}>
            참여자 추가
          </button>
        </div>
      )}
      {pendingRemoveId ? (
        <ConfirmSheet
          title="이 참여자를 앨범에서 내보낼까요?"
          description="내보내도 그 사람이 남긴 사진과 글은 앨범에 남아요."
          confirmLabel="내보내기"
          onConfirm={() => { const target = pendingRemoveId; setPendingRemoveId(null); void handleRemove(target); }}
          onCancel={() => setPendingRemoveId(null)}
        />
      ) : null}
    </section>
  );
}
