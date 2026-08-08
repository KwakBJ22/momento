# 데이터 점검 (DATA_CHECKS)

작성 2026-08-08.

**언제 돌리나** — 배포 직후, 그리고 화면에서 이상한 숫자·이름을 봤을 때.

화면만 보고는 원인을 알 수 없는 결함이 많다. 실제로 2026-08-07~08에 나온 것들이
전부 이 조회로 원인이 밝혀졌다 — `참여자 4명`(실제 2명), `내 앨범이 함께 만드는 앨범에`,
`50명이 다녀갔어요`(실제 2명). **화면을 의심하기 전에 여기를 먼저 본다.**

각 조회는 **결과가 0행이어야 정상**이다. 행이 나오면 그 자체가 결함이다.

---

## 1. 소유권 — 근거가 하나여야 한다 (SCREEN_SPEC §1)

### 1-1. 한 앨범에 owner 행이 둘 이상

```sql
select album_id, count(*) n
from album_contributors
where role = 'owner' and status = 'active'
group by album_id having count(*) > 1;
```

### 1-2. `owner_id` 와 `album_contributors` 의 owner 가 다른 앨범

```sql
select a.id, a.owner_id, c.user_id as contributor_owner
from albums a
join album_contributors c on c.album_id = a.id
where a.deleted_at is null and c.role = 'owner' and c.status = 'active'
  and c.user_id is distinct from a.owner_id;
```

### 1-3. 계정 앨범인데 `owner_id` 가 비어 있음

```sql
select id, created_by, created_at
from albums
where deleted_at is null and owner_id is null and created_by is not null;
```

> `created_by` 는 기록일 뿐 판정에 쓰지 않는다(§1). 이 행이 있으면 그 사람은
> **자기 앨범을 목록에서 못 찾는다.**

---

## 2. 참여자 — 사람 수가 맞아야 한다

### 2-1. 같은 사람이 한 앨범에 참여자 행 둘 이상

```sql
select album_id, user_id, count(*) n
from album_contributors
where status = 'active' and user_id is not null
group by album_id, user_id having count(*) > 1;
```

### 2-2. 같은 이름이 한 앨범에 둘 이상 (기기·세션마다 새로 생긴 경우)

```sql
select album_id, display_name, count(*) n
from album_contributors
where status = 'active'
group by album_id, display_name having count(*) > 1;
```

> 다른 사람이 우연히 같은 이름일 수도 있다. 행이 나오면 `guest_id` 를 보고 판단한다.

### 2-3. 표시명이 `profiles` 와 다른 행 (스냅샷이 낡음)

```sql
select c.album_id, c.display_name as in_album, p.display_name as in_profile
from album_contributors c
join profiles p on p.id = c.user_id
where c.status = 'active' and c.display_name is distinct from p.display_name;
```

> **사람 이름은 복사하지 않는다.** 계정이 있는 사람은 `profiles` 에서 읽는다.
> 게스트만 예외 — `profiles` 가 없으니 적힌 이름을 쓴다.

### 2-4. 화면에 보이는 참여자 수와 실제 수

```sql
select a.id, left(a.title, 20) title,
       (select count(*) from album_contributors c
        where c.album_id = a.id and c.status = 'active') as contributors
from albums a where a.deleted_at is null order by contributors desc;
```

> 주최자를 **포함**한 수다(§1). 화면 값과 다르면 세는 곳이 여러 개라는 뜻이다.

---

## 3. 사진 — 올린 사람이 남아야 한다

### 3-1. 업로더가 비어 있는 사진

```sql
select album_id, count(*) n
from album_photos
where deleted_at is null and uploaded_by_contributor_id is null
group by album_id;
```

> 이 값이 없으면 **캡션을 아무도 못 쓴다**(§7 — 캡션은 올린 사람만).

### 3-2. 파생물이 없는 사진 (화면에 원본이 그대로 나감)

```sql
select count(*) as no_display from album_photos
where deleted_at is null and (display_path is null or display_path = storage_path);
```

### 3-3. 앨범별 사진 수 · 캡션이 빈 사진 수

```sql
select a.id, left(a.title, 20) title,
       count(p.id) as photos,
       count(*) filter (where p.caption is null or p.caption = '') as no_caption
from albums a
left join album_photos p on p.album_id = a.id and p.deleted_at is null
where a.deleted_at is null
group by a.id, a.title order by photos desc;
```

---

## 4. 글 — 세 계층이 제자리에 있어야 한다 (§7)

```sql
select 'caption' k, count(*) n from album_photos
  where deleted_at is null and caption is not null and caption <> ''
union all select '한마디', count(*) from photo_memories where deleted_at is null
union all select '우리가 남긴 말', count(*) from album_guestbook_entries where deleted_at is null;
```

### 4-1. 폐기한 컬럼에 값이 새로 쌓이는지

```sql
select count(*) from album_photos
where deleted_at is null and comment is not null and comment <> ''
  and updated_at > '2026-08-08';
```

> `album_photos.comment` 는 `caption` 하나로 통일하며 폐기했다(§7).
> 값이 새로 들어오면 어딘가가 아직 그 컬럼을 쓴다는 뜻이다.

---

## 5. 방문 — 사람을 세는지 확인

```sql
select event_name, count(*) as events, count(distinct visitor_key) as people
from analytics_events
where created_at > now() - interval '7 days'
group by event_name order by events desc;
```

> `events` 와 `people` 이 **거의 같으면** 사람을 못 세고 있는 것이다.
> 2026-08-08 이전에는 `visitor_key` 가 없어 `album_revisited` 165건 = 사람 2명이었다.
> 주최자 본인의 방문은 세지 않는다.

---

## 6. 로그인 — 한 사람이 여러 계정으로 갈리지 않았는지

```sql
select i.provider, i.provider_id, i.user_id, u.email, u.created_at
from auth.identities i join auth.users u on u.id = i.user_id
order by u.created_at;
```

> 같은 이메일에 `user_id` 가 둘 이상이면 계정이 갈린 것이다.
> **카카오 회원번호(`provider_id`)는 앱마다 다르다.** 카카오 개발자 콘솔에서 앱을 바꾸면
> 기존 사용자 전원의 연결이 끊긴다. 2026-08-06 에 실제로 일어났다.

---

## 쓰는 법

1. Supabase SQL Editor에 붙여넣어 순서대로 돌린다.
2. **행이 나온 조회만** 원인을 본다. 0행이면 넘어간다.
3. 고치기 전에 `SCREEN_SPEC` 의 해당 절을 먼저 읽는다. 데이터가 아니라 **규칙이 틀린**
   경우가 있다.
4. 데이터를 고칠 때는 되돌릴 수 있는지 먼저 확인한다. 얻는 것이 없으면 건드리지 않는다.
