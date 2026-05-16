use base64::{engine::general_purpose, Engine as _};
use chrono::{DateTime, Local};
use image::{ImageFormat, ImageReader};
use notify::{recommended_watcher, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    cmp::Reverse,
    collections::hash_map::DefaultHasher,
    collections::{HashMap, HashSet},
    fs,
    hash::{Hash, Hasher},
    io::Cursor,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct WatchState {
    watcher: Mutex<Option<RecommendedWatcher>>,
}

struct WatchTarget {
    path: PathBuf,
    recursive_mode: RecursiveMode,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GalleryPayload {
    codex_root: String,
    images_root: String,
    codex_exists: bool,
    generated_images_exists: bool,
    state_db_exists: bool,
    images: Vec<ImageInfo>,
    sessions: Vec<SessionInfo>,
    tags: Vec<TagInfo>,
    favorite_paths: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionInfo {
    id: String,
    title: String,
    first_user_message: String,
    cwd: String,
    rollout_path: String,
    created_at_ms: Option<i64>,
    updated_at_ms: Option<i64>,
    archived: bool,
    missing: bool,
    image_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageInfo {
    id: String,
    path: String,
    filename: String,
    extension: String,
    session_id: String,
    session_title: String,
    file_size: u64,
    modified_at_ms: Option<i64>,
    width: Option<u32>,
    height: Option<u32>,
    format: String,
    favorited: bool,
    missing_session: bool,
    tags: Vec<String>,
    thumbnail_key: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TagInfo {
    id: i64,
    name: String,
    image_count: usize,
    created_at_ms: i64,
    updated_at_ms: i64,
}

#[derive(Debug, Default)]
struct AppMetadata {
    favorites: HashSet<String>,
    tags: Vec<TagInfo>,
    image_tags: HashMap<String, Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportRequest {
    paths: Vec<String>,
    target_dir: String,
    naming: String,
    custom_prefix: Option<String>,
    codex_root: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportResult {
    exported: Vec<String>,
}

#[tauri::command]
async fn scan_gallery(
    app: AppHandle,
    codex_root: Option<String>,
) -> Result<GalleryPayload, String> {
    tauri::async_runtime::spawn_blocking(move || scan_gallery_blocking(app, codex_root))
        .await
        .map_err(|error| error.to_string())?
}

fn scan_gallery_blocking(
    app: AppHandle,
    codex_root: Option<String>,
) -> Result<GalleryPayload, String> {
    let codex_root = resolve_codex_root(codex_root);
    let images_root = codex_root.join("generated_images");
    let state_db = codex_root.join("state_5.sqlite");
    let mut warnings = Vec::new();
    let mut app_metadata = load_app_metadata(&app)?;
    let mut favorite_paths: Vec<String> = app_metadata.favorites.iter().cloned().collect();
    favorite_paths.sort();

    let codex_exists = codex_root.exists();
    let generated_images_exists = images_root.exists();
    let state_db_exists = state_db.exists();

    if !codex_exists {
        warnings.push("Codex data directory was not found.".to_string());
    }
    if codex_exists && !generated_images_exists {
        warnings.push("generated_images directory was not found.".to_string());
    }
    if generated_images_exists && !state_db_exists {
        warnings.push(
            "state_5.sqlite was not found; session titles will fall back to ids.".to_string(),
        );
    }

    let session_map = if state_db_exists {
        match load_sessions(&state_db) {
            Ok(sessions) => sessions,
            Err(error) => {
                warnings.push(format!("Could not read state_5.sqlite: {error}"));
                HashMap::new()
            }
        }
    } else {
        HashMap::new()
    };

    let mut sessions: HashMap<String, SessionInfo> = HashMap::new();
    let mut images = Vec::new();

    if generated_images_exists {
        let entries = fs::read_dir(&images_root).map_err(|error| error.to_string())?;
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }

            let session_id = entry.file_name().to_string_lossy().to_string();
            let session = session_map
                .get(&session_id)
                .cloned()
                .unwrap_or_else(|| missing_session(&session_id));
            let session_title = session.title.clone();
            sessions.entry(session_id.clone()).or_insert(session);

            let Ok(image_entries) = fs::read_dir(entry.path()) else {
                continue;
            };
            for image_entry in image_entries.flatten() {
                let path = image_entry.path();
                if !is_supported_image(&path) {
                    continue;
                }
                if let Some(info) = build_image_info(
                    &path,
                    &images_root,
                    &session_id,
                    &session_title,
                    !session_map.contains_key(&session_id),
                    &app_metadata.favorites,
                    &app_metadata.image_tags,
                ) {
                    images.push(info);
                }
            }
        }
    }

    for image in &images {
        if let Some(session) = sessions.get_mut(&image.session_id) {
            session.image_count += 1;
        }
    }

    let mut sessions: Vec<SessionInfo> = sessions
        .into_values()
        .filter(|session| session.image_count > 0)
        .collect();

    images.sort_by_key(|image| Reverse(image.modified_at_ms));
    sessions.sort_by_key(|session| Reverse(session.updated_at_ms));
    update_tag_counts(&mut app_metadata.tags, &images);

    Ok(GalleryPayload {
        codex_root: path_to_string(&codex_root),
        images_root: path_to_string(&images_root),
        codex_exists,
        generated_images_exists,
        state_db_exists,
        images,
        sessions,
        tags: app_metadata.tags,
        favorite_paths,
        warnings,
    })
}

#[tauri::command]
fn toggle_favorite(
    app: AppHandle,
    path: String,
    codex_root: Option<String>,
) -> Result<bool, String> {
    let path = path_to_string(&validate_codex_image_path_for_root(
        Path::new(&path),
        codex_root,
    )?);
    let connection = app_connection(&app)?;
    init_app_db(&connection)?;
    let exists: Option<String> = connection
        .query_row(
            "select path from favorites where path = ?1",
            params![&path],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    if exists.is_some() {
        connection
            .execute("delete from favorites where path = ?1", params![&path])
            .map_err(|error| error.to_string())?;
        Ok(false)
    } else {
        connection
            .execute(
                "insert or replace into favorites(path, created_at_ms) values (?1, ?2)",
                params![&path, now_ms()],
            )
            .map_err(|error| error.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
fn add_image_tag(
    app: AppHandle,
    path: String,
    tag_name: String,
    codex_root: Option<String>,
) -> Result<Vec<String>, String> {
    let path = path_to_string(&validate_codex_image_path_for_root(
        Path::new(&path),
        codex_root,
    )?);
    let tag_name = normalize_tag_name(&tag_name)?;
    let connection = app_connection(&app)?;
    init_app_db(&connection)?;
    let tag_id = get_or_create_tag(&connection, &tag_name)?;
    connection
        .execute(
            "insert or ignore into image_tags(image_path, tag_id, created_at_ms) values (?1, ?2, ?3)",
            params![&path, tag_id, now_ms()],
        )
        .map_err(|error| error.to_string())?;
    tags_for_image(&connection, &path)
}

#[tauri::command]
fn remove_image_tag(
    app: AppHandle,
    path: String,
    tag_name: String,
    codex_root: Option<String>,
) -> Result<Vec<String>, String> {
    let path = path_to_string(&validate_codex_image_path_for_root(
        Path::new(&path),
        codex_root,
    )?);
    let tag_name = normalize_tag_name(&tag_name)?;
    let connection = app_connection(&app)?;
    init_app_db(&connection)?;
    connection
        .execute(
            "
            delete from image_tags
            where image_path = ?1
              and tag_id in (select id from tags where name = ?2 collate nocase)
            ",
            params![&path, &tag_name],
        )
        .map_err(|error| error.to_string())?;
    tags_for_image(&connection, &path)
}

#[tauri::command]
fn rename_tag(app: AppHandle, tag_id: i64, name: String) -> Result<(), String> {
    let name = normalize_tag_name(&name)?;
    let connection = app_connection(&app)?;
    init_app_db(&connection)?;
    let changed = connection
        .execute(
            "update tags set name = ?1, updated_at_ms = ?2 where id = ?3",
            params![&name, now_ms(), tag_id],
        )
        .map_err(|error| {
            if error.to_string().contains("UNIQUE") {
                "A tag with that name already exists.".to_string()
            } else {
                error.to_string()
            }
        })?;
    if changed == 0 {
        return Err("Tag was not found.".to_string());
    }
    Ok(())
}

#[tauri::command]
fn delete_tag(app: AppHandle, tag_id: i64) -> Result<(), String> {
    let connection = app_connection(&app)?;
    init_app_db(&connection)?;
    connection
        .execute("delete from image_tags where tag_id = ?1", params![tag_id])
        .map_err(|error| error.to_string())?;
    let changed = connection
        .execute("delete from tags where id = ?1", params![tag_id])
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("Tag was not found.".to_string());
    }
    Ok(())
}

#[tauri::command]
async fn export_images(request: ExportRequest) -> Result<ExportResult, String> {
    tauri::async_runtime::spawn_blocking(move || export_images_blocking(request))
        .await
        .map_err(|error| error.to_string())?
}

fn export_images_blocking(request: ExportRequest) -> Result<ExportResult, String> {
    if request.paths.is_empty() {
        return Ok(ExportResult {
            exported: Vec::new(),
        });
    }

    let target_dir = if request.target_dir.trim().is_empty() {
        dirs::download_dir()
            .or_else(|| dirs::home_dir().map(|home| home.join("Downloads")))
            .ok_or_else(|| "Could not resolve Downloads directory.".to_string())?
    } else {
        PathBuf::from(&request.target_dir)
    };

    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;
    }
    if !target_dir.is_dir() {
        return Err("Export target is not a directory.".to_string());
    }

    let images_root = resolve_codex_root(request.codex_root).join("generated_images");
    let sources = request
        .paths
        .iter()
        .map(|source| validate_codex_image_path(Path::new(source), &images_root))
        .collect::<Result<Vec<_>, _>>()?;
    let total = sources.len();
    let mut exported = Vec::new();
    for (index, source_path) in sources.iter().enumerate() {
        let filename = export_filename(
            source_path,
            &request.naming,
            request.custom_prefix.as_deref(),
            index + 1,
            total,
        );
        let destination = unique_destination(&target_dir, &filename);
        fs::copy(source_path, &destination).map_err(|error| error.to_string())?;
        exported.push(path_to_string(&destination));
    }

    Ok(ExportResult { exported })
}

#[tauri::command]
async fn read_image_data_url(path: String, codex_root: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || read_image_data_url_blocking(path, codex_root))
        .await
        .map_err(|error| error.to_string())?
}

fn read_image_data_url_blocking(
    path: String,
    codex_root: Option<String>,
) -> Result<String, String> {
    let path = validate_codex_image_path_for_root(Path::new(&path), codex_root)?;
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    let mime = mime_for_path(&path);
    Ok(format!(
        "data:{mime};base64,{}",
        general_purpose::STANDARD.encode(bytes)
    ))
}

#[tauri::command]
async fn read_thumbnail_data_url(
    app: AppHandle,
    path: String,
    codex_root: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = validate_codex_image_path_for_root(Path::new(&path), codex_root)?;
        let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
        thumbnail_data_url(&app, &path, &metadata)
            .ok_or_else(|| "Could not create thumbnail.".to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn reveal_path(path: String, codex_root: Option<String>) -> Result<(), String> {
    let path = validate_codex_image_path_for_root(Path::new(&path), codex_root)?;

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .status()
            .map_err(|error| error.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", path_to_string(&path)))
            .status()
            .map_err(|error| error.to_string())?;
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let directory = if path.is_dir() {
            path
        } else {
            path.parent().unwrap_or(Path::new("/")).to_path_buf()
        };
        Command::new("xdg-open")
            .arg(directory)
            .status()
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn start_gallery_watch(
    app: AppHandle,
    state: State<WatchState>,
    codex_root: Option<String>,
) -> Result<(), String> {
    let codex_root = resolve_codex_root(codex_root);
    let images_root = codex_root.join("generated_images");
    let state_db = codex_root.join("state_5.sqlite");
    let mut guard = state.watcher.lock().map_err(|error| error.to_string())?;
    *guard = None;

    let Some(target) = gallery_watch_target(&codex_root, &images_root) else {
        return Ok(());
    };

    let app_for_event = app.clone();
    let codex_root_for_event = codex_root.clone();
    let images_root_for_event = images_root.clone();
    let state_db_for_event = state_db.clone();
    let mut watcher = recommended_watcher(move |result: notify::Result<Event>| {
        if let Ok(event) = result {
            if matches!(
                event.kind,
                EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
            ) && event.paths.iter().any(|path| {
                is_gallery_related_path(
                    path,
                    &codex_root_for_event,
                    &images_root_for_event,
                    &state_db_for_event,
                )
            }) {
                let _ = app_for_event.emit("gallery-changed", ());
            }
        }
    })
    .map_err(|error| error.to_string())?;

    watcher
        .watch(&target.path, target.recursive_mode)
        .map_err(|error| error.to_string())?;
    *guard = Some(watcher);
    Ok(())
}

fn gallery_watch_target(codex_root: &Path, images_root: &Path) -> Option<WatchTarget> {
    if images_root.exists() {
        return Some(WatchTarget {
            path: images_root.to_path_buf(),
            recursive_mode: RecursiveMode::Recursive,
        });
    }

    if codex_root.exists() {
        return Some(WatchTarget {
            path: codex_root.to_path_buf(),
            recursive_mode: RecursiveMode::Recursive,
        });
    }

    codex_root.parent().and_then(|parent| {
        parent.exists().then(|| WatchTarget {
            path: parent.to_path_buf(),
            recursive_mode: RecursiveMode::NonRecursive,
        })
    })
}

fn is_gallery_related_path(
    path: &Path,
    codex_root: &Path,
    images_root: &Path,
    state_db: &Path,
) -> bool {
    path == codex_root || path == images_root || path.starts_with(images_root) || path == state_db
}

fn resolve_codex_root(codex_root: Option<String>) -> PathBuf {
    if let Some(root) = codex_root {
        if !root.trim().is_empty() {
            return PathBuf::from(root);
        }
    }

    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".codex")
}

fn load_sessions(state_db: &Path) -> Result<HashMap<String, SessionInfo>, String> {
    let connection = Connection::open_with_flags(state_db, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "select id, title, first_user_message, cwd, rollout_path, created_at_ms, updated_at_ms, archived from threads",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let title: String = row.get(1).unwrap_or_default();
            let first_user_message: String = row.get(2).unwrap_or_default();
            let fallback = short_id(&id);
            let display_title = first_non_empty(&title, &first_user_message, &fallback);
            Ok((
                id.clone(),
                SessionInfo {
                    id,
                    title: display_title,
                    first_user_message,
                    cwd: row.get(3).unwrap_or_default(),
                    rollout_path: row.get(4).unwrap_or_default(),
                    created_at_ms: row.get(5).ok(),
                    updated_at_ms: row.get(6).ok(),
                    archived: row.get::<_, i64>(7).unwrap_or(0) == 1,
                    missing: false,
                    image_count: 0,
                },
            ))
        })
        .map_err(|error| error.to_string())?;

    let mut sessions = HashMap::new();
    for row in rows {
        let (id, session) = row.map_err(|error| error.to_string())?;
        sessions.insert(id, session);
    }
    Ok(sessions)
}

fn build_image_info(
    path: &Path,
    images_root: &Path,
    session_id: &str,
    session_title: &str,
    missing_session: bool,
    favorites: &HashSet<String>,
    image_tags: &HashMap<String, Vec<String>>,
) -> Option<ImageInfo> {
    let path = validate_codex_image_path(path, images_root).ok()?;
    let metadata = fs::metadata(&path).ok()?;
    let modified_at_ms = metadata.modified().ok().and_then(system_time_ms);
    let extension = path
        .extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let filename = path.file_name()?.to_string_lossy().to_string();
    let (width, height) = image::image_dimensions(&path)
        .map(|dimensions| (Some(dimensions.0), Some(dimensions.1)))
        .unwrap_or((None, None));
    let path_string = path_to_string(&path);
    let thumbnail_key = thumbnail_cache_key(&path, &metadata);

    Some(ImageInfo {
        id: path_string.clone(),
        path: path_string.clone(),
        filename,
        extension: extension.clone(),
        session_id: session_id.to_string(),
        session_title: session_title.to_string(),
        file_size: metadata.len(),
        modified_at_ms,
        width,
        height,
        format: extension.to_uppercase(),
        favorited: favorites.contains(&path_string),
        missing_session,
        tags: image_tags.get(&path_string).cloned().unwrap_or_default(),
        thumbnail_key,
    })
}

fn is_supported_image(path: &Path) -> bool {
    path.extension()
        .map(|extension| {
            matches!(
                extension.to_string_lossy().to_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "tif" | "tiff"
            )
        })
        .unwrap_or(false)
}

fn validate_codex_image_path_for_root(
    path: &Path,
    codex_root: Option<String>,
) -> Result<PathBuf, String> {
    let images_root = resolve_codex_root(codex_root).join("generated_images");
    validate_codex_image_path(path, &images_root)
}

fn validate_codex_image_path(path: &Path, images_root: &Path) -> Result<PathBuf, String> {
    if !is_supported_image(path) {
        return Err("Unsupported image type.".to_string());
    }

    let image_path = fs::canonicalize(path).map_err(|error| error.to_string())?;
    if !image_path.is_file() {
        return Err("Image path is not a file.".to_string());
    }

    let images_root = fs::canonicalize(images_root).map_err(|error| error.to_string())?;
    if !image_path.starts_with(&images_root) {
        return Err("Image is outside the Codex generated_images directory.".to_string());
    }

    Ok(image_path)
}

fn thumbnail_data_url(app: &AppHandle, path: &Path, metadata: &fs::Metadata) -> Option<String> {
    let cache_path = thumbnail_cache_path(app, path, metadata).ok()?;
    if let Ok(bytes) = fs::read(&cache_path) {
        return Some(png_data_url(&bytes));
    }

    let image = ImageReader::open(path).ok()?.decode().ok()?;
    let thumbnail = image.thumbnail(512, 512);
    let mut cursor = Cursor::new(Vec::new());
    thumbnail.write_to(&mut cursor, ImageFormat::Png).ok()?;
    let bytes = cursor.into_inner();
    if let Some(parent) = cache_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&cache_path, &bytes);
    Some(png_data_url(&bytes))
}

fn thumbnail_cache_path(
    app: &AppHandle,
    path: &Path,
    metadata: &fs::Metadata,
) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(app_dir
        .join("thumbnail-cache")
        .join(format!("{}.png", thumbnail_cache_key(path, metadata))))
}

fn thumbnail_cache_key(path: &Path, metadata: &fs::Metadata) -> String {
    let mut hasher = DefaultHasher::new();
    path_to_string(path).hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    metadata
        .modified()
        .ok()
        .and_then(system_time_ms)
        .unwrap_or(0)
        .hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn png_data_url(bytes: &[u8]) -> String {
    format!(
        "data:image/png;base64,{}",
        general_purpose::STANDARD.encode(bytes)
    )
}

fn mime_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .as_deref()
    {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        Some("tif" | "tiff") => "image/tiff",
        _ => "image/png",
    }
}

fn missing_session(session_id: &str) -> SessionInfo {
    SessionInfo {
        id: session_id.to_string(),
        title: format!("Missing Session · {}", short_id(session_id)),
        first_user_message: String::new(),
        cwd: String::new(),
        rollout_path: String::new(),
        created_at_ms: None,
        updated_at_ms: None,
        archived: false,
        missing: true,
        image_count: 0,
    }
}

fn load_app_metadata(app: &AppHandle) -> Result<AppMetadata, String> {
    let connection = app_connection(app)?;
    init_app_db(&connection)?;
    Ok(AppMetadata {
        favorites: load_favorites(&connection)?,
        tags: load_tags(&connection)?,
        image_tags: load_image_tags(&connection)?,
    })
}

fn load_favorites(connection: &Connection) -> Result<HashSet<String>, String> {
    let mut statement = connection
        .prepare("select path from favorites")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;

    let mut favorites = HashSet::new();
    for row in rows {
        favorites.insert(row.map_err(|error| error.to_string())?);
    }
    Ok(favorites)
}

fn load_tags(connection: &Connection) -> Result<Vec<TagInfo>, String> {
    let mut statement = connection
        .prepare("select id, name, created_at_ms, updated_at_ms from tags order by lower(name)")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(TagInfo {
                id: row.get(0)?,
                name: row.get(1)?,
                image_count: 0,
                created_at_ms: row.get(2)?,
                updated_at_ms: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;

    let mut tags = Vec::new();
    for row in rows {
        tags.push(row.map_err(|error| error.to_string())?);
    }
    Ok(tags)
}

fn load_image_tags(connection: &Connection) -> Result<HashMap<String, Vec<String>>, String> {
    let mut statement = connection
        .prepare(
            "
            select image_tags.image_path, tags.name
            from image_tags
            join tags on tags.id = image_tags.tag_id
            order by lower(tags.name)
            ",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;

    let mut image_tags: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let (path, tag_name) = row.map_err(|error| error.to_string())?;
        image_tags.entry(path).or_default().push(tag_name);
    }
    Ok(image_tags)
}

fn update_tag_counts(tags: &mut [TagInfo], images: &[ImageInfo]) {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for image in images {
        for tag in &image.tags {
            *counts.entry(tag.to_lowercase()).or_insert(0) += 1;
        }
    }
    for tag in tags {
        tag.image_count = counts.get(&tag.name.to_lowercase()).copied().unwrap_or(0);
    }
}

fn get_or_create_tag(connection: &Connection, name: &str) -> Result<i64, String> {
    connection
        .execute(
            "insert or ignore into tags(name, created_at_ms, updated_at_ms) values (?1, ?2, ?2)",
            params![name, now_ms()],
        )
        .map_err(|error| error.to_string())?;

    connection
        .query_row(
            "select id from tags where name = ?1 collate nocase",
            params![name],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

fn tags_for_image(connection: &Connection, path: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "
            select tags.name
            from image_tags
            join tags on tags.id = image_tags.tag_id
            where image_tags.image_path = ?1
            order by lower(tags.name)
            ",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![path], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;

    let mut tags = Vec::new();
    for row in rows {
        tags.push(row.map_err(|error| error.to_string())?);
    }
    Ok(tags)
}

fn normalize_tag_name(value: &str) -> Result<String, String> {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return Err("Tag name cannot be empty.".to_string());
    }
    if normalized.chars().any(char::is_control) {
        return Err("Tag name cannot contain control characters.".to_string());
    }
    if normalized.chars().count() > 48 {
        return Err("Tag name must be 48 characters or fewer.".to_string());
    }
    Ok(normalized)
}

fn app_connection(app: &AppHandle) -> Result<Connection, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&app_dir).map_err(|error| error.to_string())?;
    Connection::open(app_dir.join("codex-gallery.db")).map_err(|error| error.to_string())
}

fn init_app_db(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            create table if not exists favorites (
              path text primary key,
              created_at_ms integer not null
            );

            create table if not exists tags (
              id integer primary key autoincrement,
              name text not null unique collate nocase,
              created_at_ms integer not null,
              updated_at_ms integer not null
            );

            create table if not exists image_tags (
              image_path text not null,
              tag_id integer not null,
              created_at_ms integer not null,
              primary key (image_path, tag_id)
            );

            create index if not exists image_tags_tag_id_idx on image_tags(tag_id);
            create index if not exists image_tags_image_path_idx on image_tags(image_path);
            ",
        )
        .map_err(|error| error.to_string())
}

fn export_filename(
    source: &Path,
    naming: &str,
    custom_prefix: Option<&str>,
    index: usize,
    total: usize,
) -> String {
    let extension = source
        .extension()
        .map(|extension| extension.to_string_lossy().to_string())
        .unwrap_or_else(|| "png".to_string());
    let original_stem = source
        .file_stem()
        .map(|stem| sanitize_filename(&stem.to_string_lossy()))
        .unwrap_or_else(|| "image".to_string());
    let session_slug = source
        .parent()
        .and_then(Path::file_name)
        .map(|name| sanitize_filename(&short_id(&name.to_string_lossy())))
        .unwrap_or_else(|| "session".to_string());
    let date = source
        .metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(format_date)
        .unwrap_or_else(|| "undated".to_string());
    let width = total.max(1).to_string().len().max(2);

    let stem = match naming {
        "date-session-index" => format!("{date}-{session_slug}-{index:0width$}"),
        "session-filename" => format!("{session_slug}-{original_stem}"),
        "custom-prefix" => format!(
            "{}-{index:0width$}",
            sanitize_filename(custom_prefix.unwrap_or("codex-image"))
        ),
        _ => original_stem,
    };

    format!("{stem}.{extension}")
}

fn unique_destination(target_dir: &Path, filename: &str) -> PathBuf {
    let candidate = target_dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }

    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| "image".to_string());
    let extension = path
        .extension()
        .map(|extension| extension.to_string_lossy().to_string())
        .unwrap_or_default();

    for counter in 2.. {
        let next = if extension.is_empty() {
            target_dir.join(format!("{stem}-{counter}"))
        } else {
            target_dir.join(format!("{stem}-{counter}.{extension}"))
        };
        if !next.exists() {
            return next;
        }
    }

    candidate
}

fn sanitize_filename(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else if character.is_whitespace() {
                '-'
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = sanitized.trim_matches(['-', '_', '.']).to_string();
    if trimmed.is_empty() {
        "image".to_string()
    } else {
        trimmed
    }
}

fn format_date(time: SystemTime) -> String {
    let datetime: DateTime<Local> = time.into();
    datetime.format("%Y%m%d").to_string()
}

fn first_non_empty(first: &str, second: &str, fallback: &str) -> String {
    if !first.trim().is_empty() {
        first.trim().to_string()
    } else if !second.trim().is_empty() {
        second.trim().to_string()
    } else {
        fallback.to_string()
    }
}

fn short_id(id: &str) -> String {
    id.chars().take(8).collect()
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn system_time_ms(time: SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as i64)
}

fn now_ms() -> i64 {
    system_time_ms(SystemTime::now()).unwrap_or(0)
}

pub fn run() {
    tauri::Builder::default()
        .manage(WatchState::default())
        .invoke_handler(tauri::generate_handler![
            scan_gallery,
            toggle_favorite,
            add_image_tag,
            remove_image_tag,
            rename_tag,
            delete_tag,
            export_images,
            read_image_data_url,
            read_thumbnail_data_url,
            reveal_path,
            start_gallery_watch
        ])
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            fs::create_dir_all(app_dir)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Codex Gallery");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_test_dir(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "codex-gallery-{name}-{}-{}",
            std::process::id(),
            now_ms()
        ));
        fs::create_dir_all(&directory).expect("create test directory");
        directory
    }

    #[test]
    fn missing_session_title_uses_short_id() {
        let session = missing_session("123456789abcdef");
        assert_eq!(session.title, "Missing Session · 12345678");
        assert!(session.missing);
    }

    #[test]
    fn unique_destination_appends_counter_for_existing_file() {
        let directory = temp_test_dir("unique-destination");
        let existing = directory.join("image.png");
        fs::write(&existing, b"existing").expect("write existing file");

        let destination = unique_destination(&directory, "image.png");

        assert_eq!(destination, directory.join("image-2.png"));
        fs::remove_dir_all(directory).expect("remove test directory");
    }

    #[test]
    fn validate_codex_image_path_accepts_images_under_root() {
        let directory = temp_test_dir("validate-image");
        let images_root = directory.join("generated_images");
        let session_dir = images_root.join("session-id");
        fs::create_dir_all(&session_dir).expect("create session directory");
        let image = session_dir.join("image.png");
        fs::write(&image, b"not decoded in this test").expect("write image placeholder");

        let validated = validate_codex_image_path(&image, &images_root).expect("validate image");

        assert_eq!(
            validated,
            fs::canonicalize(&image).expect("canonical image")
        );
        fs::remove_dir_all(directory).expect("remove test directory");
    }

    #[test]
    fn validate_codex_image_path_rejects_images_outside_root() {
        let directory = temp_test_dir("reject-outside-image");
        let images_root = directory.join("generated_images");
        fs::create_dir_all(&images_root).expect("create images directory");
        let outside = directory.join("outside.png");
        fs::write(&outside, b"outside").expect("write outside image placeholder");

        let error = validate_codex_image_path(&outside, &images_root).expect_err("reject outside");

        assert_eq!(
            error,
            "Image is outside the Codex generated_images directory."
        );
        fs::remove_dir_all(directory).expect("remove test directory");
    }

    #[test]
    fn normalize_tag_name_trims_and_collapses_spaces() {
        let name = normalize_tag_name("  app   icon  ").expect("normalize tag");

        assert_eq!(name, "app icon");
    }

    #[test]
    fn normalize_tag_name_rejects_empty_names() {
        let error = normalize_tag_name("   ").expect_err("reject empty tag");

        assert_eq!(error, "Tag name cannot be empty.");
    }

    #[test]
    fn watch_target_observes_parent_when_codex_root_is_missing() {
        let directory = temp_test_dir("watch-parent");
        let codex_root = directory.join(".codex");
        let images_root = codex_root.join("generated_images");

        let target = gallery_watch_target(&codex_root, &images_root).expect("watch target");

        assert_eq!(target.path, directory);
        assert!(matches!(target.recursive_mode, RecursiveMode::NonRecursive));
        fs::remove_dir_all(target.path).expect("remove test directory");
    }
}
