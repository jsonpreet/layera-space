//! Real-repository tests for the run engine's git layer.
//!
//! The engine's core promise is that it can tell exactly what a run changed
//! *without disturbing the user's repository*. Both halves are asserted here
//! against actual `git` invocations in a temp repo.

use layera_space_lib::run::git::{diff_numstat, diff_patch, repo_root, snapshot_tree};
use std::path::{Path, PathBuf};
use std::process::Command;

fn run(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .expect("git should be installed");
    assert!(
        out.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).to_string()
}

struct TempRepo {
    path: PathBuf,
}

impl TempRepo {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!("layera-git-test-{name}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        run(&path, &["init", "-q"]);
        run(&path, &["config", "user.email", "test@localhost"]);
        run(&path, &["config", "user.name", "Test"]);
        Self { path }
    }

    fn write(&self, rel: &str, content: &str) {
        let p = self.path.join(rel);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(p, content).unwrap();
    }

    fn commit_all(&self, message: &str) {
        run(&self.path, &["add", "-A"]);
        run(&self.path, &["commit", "-q", "-m", message]);
    }

    fn root(&self) -> String {
        self.path.to_string_lossy().to_string()
    }

    fn status(&self) -> String {
        run(&self.path, &["status", "--porcelain"])
    }

    fn index_path(&self) -> PathBuf {
        self.path.join(".layera-test-index")
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[test]
fn finds_the_repository_root() {
    let repo = TempRepo::new("root");
    repo.write("nested/deep/file.txt", "x");
    repo.commit_all("init");

    let found = repo_root(&repo.path.join("nested/deep").to_string_lossy()).unwrap();
    // macOS reports /var and /private/var for the same directory.
    assert!(found.ends_with(repo.path.file_name().unwrap().to_str().unwrap()));

    assert_eq!(repo_root("/"), None, "a non-repo must not report a root");
}

#[test]
fn snapshot_captures_edits_to_already_dirty_files() {
    // The reason this uses a temp index rather than `git status` diffing: a file
    // that was already modified before the run still has to show the run's own
    // change to it.
    let repo = TempRepo::new("dirty");
    repo.write("a.txt", "committed\n");
    repo.commit_all("init");

    repo.write("a.txt", "user edit\n");
    let base = snapshot_tree(&repo.root(), &repo.index_path()).unwrap();

    repo.write("a.txt", "user edit\nagent edit\n");
    let after = snapshot_tree(&repo.root(), &repo.index_path()).unwrap();

    assert_ne!(base, after, "the agent's edit must change the tree");
    let changes = diff_numstat(&repo.root(), &base, &after);
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].path, "a.txt");
    assert_eq!(changes[0].added, 1);
    assert_eq!(changes[0].deleted, 0);
    assert_eq!(changes[0].status, "M");
}

#[test]
fn snapshot_sees_untracked_files() {
    let repo = TempRepo::new("untracked");
    repo.write("kept.txt", "x\n");
    repo.commit_all("init");

    let base = snapshot_tree(&repo.root(), &repo.index_path()).unwrap();
    repo.write("brand-new.txt", "hello\n");
    let after = snapshot_tree(&repo.root(), &repo.index_path()).unwrap();

    let changes = diff_numstat(&repo.root(), &base, &after);
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].path, "brand-new.txt");
    assert_eq!(changes[0].status, "A");
}

#[test]
fn snapshot_respects_gitignore() {
    let repo = TempRepo::new("ignored");
    repo.write(".gitignore", "secret.txt\n");
    repo.commit_all("init");

    let base = snapshot_tree(&repo.root(), &repo.index_path()).unwrap();
    repo.write("secret.txt", "should not appear\n");
    let after = snapshot_tree(&repo.root(), &repo.index_path()).unwrap();

    assert_eq!(base, after, "an ignored file must not register as a change");
}

#[test]
fn snapshot_records_deletions() {
    let repo = TempRepo::new("deleted");
    repo.write("gone.txt", "bye\n");
    repo.commit_all("init");

    let base = snapshot_tree(&repo.root(), &repo.index_path()).unwrap();
    std::fs::remove_file(repo.path.join("gone.txt")).unwrap();
    let after = snapshot_tree(&repo.root(), &repo.index_path()).unwrap();

    let changes = diff_numstat(&repo.root(), &base, &after);
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].status, "D");
}

#[test]
fn snapshot_leaves_the_users_repository_untouched() {
    // The single most important property: capturing a diff must never stage,
    // commit, or otherwise disturb what the user has in progress.
    let repo = TempRepo::new("untouched");
    repo.write("tracked.txt", "one\n");
    repo.commit_all("init");
    repo.write("tracked.txt", "one\ntwo\n");
    repo.write("untracked.txt", "new\n");

    let head_before = run(&repo.path, &["rev-parse", "HEAD"]);
    let status_before = repo.status();

    let base = snapshot_tree(&repo.root(), &repo.index_path()).unwrap();
    repo.write("tracked.txt", "one\ntwo\nthree\n");
    let after = snapshot_tree(&repo.root(), &repo.index_path()).unwrap();
    let _ = diff_patch(&repo.root(), &base, &after);

    assert_eq!(head_before, run(&repo.path, &["rev-parse", "HEAD"]));
    assert_eq!(
        status_before.lines().filter(|l| l.starts_with("M ")).count(),
        0,
        "nothing should have been staged"
    );
    // The working tree still shows the user's own changes as unstaged.
    let status_after = repo.status();
    assert!(status_after.contains("tracked.txt"));
    assert!(status_after.contains("untracked.txt"));
    assert!(
        !repo.index_path().exists(),
        "the scratch index must be cleaned up"
    );
}

#[test]
fn snapshot_works_in_a_repo_with_no_commits() {
    // A freshly `git init`ed folder has an unborn HEAD; read-tree HEAD fails and
    // the empty-tree fallback has to take over.
    let repo = TempRepo::new("unborn");
    let base = snapshot_tree(&repo.root(), &repo.index_path()).unwrap();
    repo.write("first.txt", "hello\n");
    let after = snapshot_tree(&repo.root(), &repo.index_path()).unwrap();

    assert_ne!(base, after);
    let changes = diff_numstat(&repo.root(), &base, &after);
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].path, "first.txt");
}

#[test]
fn patch_round_trips_through_apply() {
    let repo = TempRepo::new("patch");
    repo.write("a.txt", "one\n");
    repo.commit_all("init");

    let base = snapshot_tree(&repo.root(), &repo.index_path()).unwrap();
    repo.write("a.txt", "one\ntwo\n");
    let after = snapshot_tree(&repo.root(), &repo.index_path()).unwrap();

    let patch = diff_patch(&repo.root(), &base, &after);
    assert!(patch.contains("+two"));

    // Reverse-applying the recorded patch is exactly what "revert all" does.
    let patch_file = repo.path.join("p.diff");
    std::fs::write(&patch_file, &patch).unwrap();
    run(
        &repo.path,
        &["apply", "--reverse", patch_file.to_str().unwrap()],
    );
    assert_eq!(
        std::fs::read_to_string(repo.path.join("a.txt")).unwrap(),
        "one\n"
    );
}

#[test]
fn worktree_isolates_a_builder_and_keeps_the_main_tree_clean() {
    let repo = TempRepo::new("worktree");
    repo.write("shared.txt", "base\n");
    repo.commit_all("init");
    // Uncommitted work the user has in progress.
    repo.write("shared.txt", "base\nuser wip\n");

    // The wave base: a commit built from the dirty tree, without touching HEAD.
    let tree = snapshot_tree(&repo.root(), &repo.index_path()).unwrap();
    let head = run(&repo.path, &["rev-parse", "HEAD"]).trim().to_string();
    let base = run(
        &repo.path,
        &["commit-tree", &tree, "-p", &head, "-m", "wave base"],
    )
    .trim()
    .to_string();

    let wt = repo.path.join("../layera-git-test-worktree-wt");
    let wt_str = wt.to_string_lossy().to_string();
    let _ = std::fs::remove_dir_all(&wt);
    run(
        &repo.path,
        &["worktree", "add", "-b", "layera/b1", &wt_str, &base],
    );

    // The builder starts from what the user actually sees, wip included.
    assert_eq!(
        std::fs::read_to_string(wt.join("shared.txt")).unwrap(),
        "base\nuser wip\n",
        "uncommitted work must carry into the worktree"
    );

    std::fs::write(wt.join("shared.txt"), "base\nuser wip\nbuilder\n").unwrap();
    run(&wt, &["add", "-A"]);
    run(
        &wt,
        &[
            "-c",
            "user.name=Layera",
            "-c",
            "user.email=layera@localhost",
            "commit",
            "-q",
            "-m",
            "builder",
        ],
    );
    let tip = run(&wt, &["rev-parse", "HEAD"]).trim().to_string();

    let changes = diff_numstat(&repo.root(), &base, &tip);
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].added, 1, "only the builder's line is new");

    // The user's own tree is exactly as they left it.
    assert_eq!(
        std::fs::read_to_string(repo.path.join("shared.txt")).unwrap(),
        "base\nuser wip\n"
    );
    assert_eq!(run(&repo.path, &["rev-parse", "HEAD"]).trim(), head);

    run(&repo.path, &["worktree", "remove", "--force", &wt_str]);
    let _ = std::fs::remove_dir_all(&wt);
}
