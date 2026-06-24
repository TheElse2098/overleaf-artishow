#!/usr/bin/env python3
"""
Populate the Overleaf Mongo database with fake users + projects + docs so the
admin "User Statistics" page (scripts/recompute_user_stats.mjs) has something
heavy to show. The total on-disk doc content is sized to a target (default 10 GB).

How the recompute reads sizes (so we match it exactly):
  - Per project, it walks project.rootFolder[].docs[] to get each doc's _id.
  - For each doc _id it sums $strLenBytes over db.docs.<doc>.lines.
  - File sizes come from history-v1 blobs (hard to fake), so we put EVERYTHING
    in docs. The "Files" column stays 0; "Docs"/"Total" carry the whole target.

Layout:
  - user_i@local.com for i in 1..N+1  (N = --users, default 500; +1 because
    user_1 is special).
  - Every user owns --projects-per-user projects, EXCEPT user_1 who owns 3x.
  - Each project has --docs-per-project docs; each doc holds ~--doc-bytes of
    text in `lines` (kept well under the 16 MB BSON limit).

The byte budget is split evenly across "project slots" (user_1 counting as 3),
so the grand total of doc content lands close to --target-gb.

Connection (no host port is exposed by the default docker-compose):
  Easiest is to run this from a throwaway python container on the stack network:

    docker run --rm -it --network <stack>_default \
      -v "$PWD/scripts:/s" -e MONGO_URL=mongodb://mongo/sharelatex \
      python:3.12-slim bash -c "pip install pymongo && python /s/populate_user_stats.py --commit"

  Or expose the port (add `ports: ["27017:27017"]` to the mongo service) and run
  on the host with the default MONGO_URL.

Usage:
  python populate_user_stats.py                 # dry run: print the plan only
  python populate_user_stats.py --commit        # actually write
  python populate_user_stats.py --commit --target-gb 10 --users 500
  python populate_user_stats.py --commit --clean # remove previously seeded data first
"""

import argparse
import datetime
import os
import sys

def _require_pymongo():
    """Imported lazily so the dry run (pure arithmetic) needs no dependencies."""
    try:
        from pymongo import MongoClient, InsertOne
        from bson import ObjectId
    except ImportError:
        sys.exit("pymongo is required for --commit/--clean: pip install pymongo")
    return MongoClient, InsertOne, ObjectId

EMAIL_DOMAIN = "local.com"
# Tag every seeded document so --clean can find and remove exactly what we made,
# without touching real data.
SEED_TAG = "seed:user-stats-populate"

GB = 1024 ** 3
MB = 1024 ** 2


def parse_args():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--mongo-url",
                   default=os.environ.get("MONGO_URL",
                                          "mongodb://localhost:27017/sharelatex"),
                   help="Mongo connection string (default: $MONGO_URL or localhost)")
    p.add_argument("--target-gb", type=float, default=10.0,
                   help="Total doc content to create, in GB (default: 10)")
    p.add_argument("--users", type=int, default=500,
                   help="Number of normal users (user_2..). user_1 is extra. (default 500)")
    p.add_argument("--projects-per-user", type=int, default=2,
                   help="Projects each normal user owns (user_1 gets 3x). (default 2)")
    p.add_argument("--docs-per-project", type=int, default=5,
                   help="Docs per project (default 5)")
    p.add_argument("--doc-bytes", type=int, default=3 * MB,
                   help="Max bytes of text per doc; capped under the 16MB BSON "
                        "limit (default 3MB)")
    p.add_argument("--batch", type=int, default=500,
                   help="Bulk insert batch size (default 500)")
    p.add_argument("--commit", action="store_true",
                   help="Actually write to Mongo (otherwise dry run)")
    p.add_argument("--clean", action="store_true",
                   help="Delete previously seeded users/projects/docs, then exit "
                        "(unless combined with a fresh run)")
    return p.parse_args()


# One "line" of text. Repeating a fixed chunk makes byte accounting exact:
# $strLenBytes counts UTF-8 bytes, and ASCII is 1 byte/char.
LINE = "x" * 80  # 80 bytes per line (newlines are not stored in `lines`)
LINE_BYTES = len(LINE.encode("utf-8"))


def make_lines(num_bytes):
    """Return a `lines` array whose total UTF-8 byte length is ~num_bytes."""
    n_full = num_bytes // LINE_BYTES
    remainder = num_bytes - n_full * LINE_BYTES
    lines = [LINE] * n_full
    if remainder > 0:
        lines.append("x" * remainder)
    return lines


def _utcnow():
    # timezone-aware UTC; datetime.UTC exists on 3.11+, fall back otherwise.
    tz = getattr(datetime, "UTC", datetime.timezone.utc)
    return datetime.datetime.now(tz)


def human(n):
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if abs(n) < 1024 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024


def connect(mongo_url):
    MongoClient, _, _ = _require_pymongo()
    client = MongoClient(mongo_url)
    db = client.get_default_database()
    if db is None:
        db = client["sharelatex"]
    return db


def main():
    args = parse_args()

    if args.clean:
        db = connect(args.mongo_url)
        clean(db, commit=args.commit)
        if not args.commit:
            print("(dry run — pass --commit to actually delete)")
        # Allow --clean alone to just clean; a populate run can be a separate call.
        return

    target_bytes = int(args.target_gb * GB)
    doc_bytes_cap = min(args.doc_bytes, 15 * MB)  # stay under 16MB BSON limit

    # "Slots" = total number of project-equivalents. user_1 counts as 3x.
    normal_users = args.users
    user1_projects = args.projects_per_user * 3
    total_projects = normal_users * args.projects_per_user + user1_projects
    total_docs = total_projects * args.docs_per_project

    # Bytes per doc needed to hit the target, capped so no single doc is too big.
    bytes_per_doc = target_bytes // total_docs
    if bytes_per_doc > doc_bytes_cap:
        print(f"WARNING: target needs {human(bytes_per_doc)}/doc but cap is "
              f"{human(doc_bytes_cap)}. Increase --docs-per-project or "
              f"--projects-per-user, or lower --target-gb. Capping per doc.")
        bytes_per_doc = doc_bytes_cap
    bytes_per_doc = max(bytes_per_doc, LINE_BYTES)

    achieved = bytes_per_doc * total_docs

    print("Plan")
    print(f"  mongo            : {args.mongo_url}")
    print(f"  target           : {human(target_bytes)}")
    print(f"  normal users     : {normal_users} (user_2 .. user_{normal_users + 1})")
    print(f"  user_1 projects  : {user1_projects} (3x a normal user)")
    print(f"  projects total   : {total_projects}")
    print(f"  docs total       : {total_docs}")
    print(f"  bytes / doc      : {human(bytes_per_doc)}")
    print(f"  ACHIEVED TOTAL   : {human(achieved)}")
    print()

    if not args.commit:
        print("(dry run — pass --commit to actually write)")
        return

    _, InsertOne, ObjectId = _require_pymongo()
    db = connect(args.mongo_url)
    users_col = db["users"]
    projects_col = db["projects"]
    docs_col = db["docs"]

    now = _utcnow()
    written_docs = 0
    written_bytes = 0

    def owner_count(user_index):
        # user_1 (index 1) gets 3x projects.
        return user1_projects if user_index == 1 else args.projects_per_user

    user_ops = []
    project_ops = []
    doc_ops = []

    def flush(col, ops):
        if ops:
            col.bulk_write(ops, ordered=False)
            ops.clear()

    for i in range(1, normal_users + 2):  # 1 .. normal_users+1
        user_id = ObjectId()
        email = f"user_{i}@{EMAIL_DOMAIN}"
        # lastLoggedIn spread out a bit so the column isn't uniform.
        last_login = now - datetime.timedelta(days=(i % 30))
        user_ops.append(InsertOne({
            "_id": user_id,
            "email": email,
            "emails": [{"email": email, "reversedHostname": "moc.lacol",
                        "createdAt": now}],
            "first_name": f"User{i}",
            "last_name": "Seed",
            "signUpDate": now,
            "lastLoggedIn": last_login,
            "loginCount": 1,
            "isAdmin": False,
            "_seed": SEED_TAG,
        }))

        for p in range(owner_count(i)):
            project_id = ObjectId()
            docs_meta = []  # entries for rootFolder.docs

            for d in range(args.docs_per_project):
                doc_id = ObjectId()
                lines = make_lines(bytes_per_doc)
                doc_ops.append(InsertOne({
                    "_id": doc_id,
                    "project_id": project_id,
                    "lines": lines,
                    "rev": 1,
                    "version": 0,
                    "_seed": SEED_TAG,
                }))
                docs_meta.append({"_id": doc_id, "name": f"doc_{d}.tex"})
                written_docs += 1
                written_bytes += bytes_per_doc

                if len(doc_ops) >= args.batch:
                    flush(docs_col, doc_ops)

            project_ops.append(InsertOne({
                "_id": project_id,
                "name": f"Project {p} of user_{i}",
                "owner_ref": user_id,
                "lastUpdated": now,
                "active": True,
                "rootFolder": [{
                    "_id": ObjectId(),
                    "name": "rootFolder",
                    "docs": docs_meta,
                    "fileRefs": [],
                    "folders": [],
                }],
                "_seed": SEED_TAG,
            }))

            if len(project_ops) >= args.batch:
                flush(projects_col, project_ops)

        if len(user_ops) >= args.batch:
            flush(users_col, user_ops)

        if i % 50 == 0 or i == normal_users + 1:
            print(f"  ... prepared user {i}/{normal_users + 1} "
                  f"(docs so far ~{human(written_bytes)})")

    flush(users_col, user_ops)
    flush(projects_col, project_ops)
    flush(docs_col, doc_ops)

    print()
    print(f"Done. Inserted ~{written_docs} docs, ~{human(written_bytes)} of content.")
    print("Now run the recompute to populate the admin page:")
    print("  node scripts/recompute_user_stats.mjs --commit --full")


def clean(db, commit):
    """Remove everything tagged by a previous seed run."""
    n_docs = db["docs"].count_documents({"_seed": SEED_TAG})
    n_proj = db["projects"].count_documents({"_seed": SEED_TAG})
    n_users = db["users"].count_documents({"_seed": SEED_TAG})
    print(f"Seeded data found: {n_users} users, {n_proj} projects, {n_docs} docs")
    if not commit:
        return
    db["docs"].delete_many({"_seed": SEED_TAG})
    db["projects"].delete_many({"_seed": SEED_TAG})
    db["users"].delete_many({"_seed": SEED_TAG})
    # The recompute snapshot points at users that no longer exist; clear it too.
    db["userStats"].delete_many({})
    print("Deleted seeded users/projects/docs and cleared userStats snapshot.")


if __name__ == "__main__":
    main()
