// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::process::Command;
use encoding_rs::{WINDOWS_1252, UTF_16LE, UTF_16BE};
use winapi::um::shellapi::ShellExecuteW;
use winapi::um::winuser::SW_SHOW;
use tauri::{Manager, Emitter};

// OPEN FILES FROM OS (CLI)
#[tauri::command]
fn get_opened_file() -> Vec<String> {
    std::env::args().skip(1).collect()
}

// FILE READ (AUTO ENCODING)
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;

    // UTF-8 BOM
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Ok(String::from_utf8_lossy(&bytes[3..]).to_string());
    }

    // UTF-16 LE BOM
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let (text, _, _) = UTF_16LE.decode(&bytes[2..]);
        return Ok(text.to_string());
    }

    // UTF-16 BE BOM
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let (text, _, _) = UTF_16BE.decode(&bytes[2..]);
        return Ok(text.to_string());
    }

    // Try UTF-8
    if let Ok(text) = String::from_utf8(bytes.clone()) {
        return Ok(text);
    }

    // Fallback Windows ANSI (1252)
    let (text, _, _) = WINDOWS_1252.decode(&bytes);
    Ok(text.to_string())
}

// FILE WRITE
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

// REVEAL FILE IN EXPLORER
#[tauri::command]
fn reveal_file(path: String) {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .unwrap();
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &path])
            .spawn()
            .unwrap();
    }

    #[cfg(target_os = "linux")]
    {
        let folder = std::path::Path::new(&path).parent().unwrap();
        Command::new("xdg-open")
            .arg(folder)
            .spawn()
            .unwrap();
    }
}

// WINDOWS PRINT
#[cfg(target_os = "windows")]
#[tauri::command]
fn open_native_print_dialog(path: String) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::shellapi::ShellExecuteW;
    use winapi::um::winuser::SW_SHOW;

    let operation: Vec<u16> = OsStr::new("print").encode_wide().chain(Some(0)).collect();
    let file: Vec<u16> = OsStr::new(&path).encode_wide().chain(Some(0)).collect();

    unsafe {
        let result = ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOW,
        );

        if (result as usize) <= 32 {
            return Err(format!("Print failed: {:?}", result));
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn show_print_dialog() -> Result<(), String> {
    use winapi::um::commdlg::{PrintDlgW, PRINTDLGW};
    use winapi::shared::windef::HWND;
    use std::mem::zeroed;

    unsafe {
        let mut pd: PRINTDLGW = zeroed();
        pd.lStructSize = std::mem::size_of::<PRINTDLGW>() as u32;
        pd.Flags = 0; // You can set flags as needed
        pd.hwndOwner = std::ptr::null_mut() as HWND;

        if PrintDlgW(&mut pd) == 0 {
            return Err("User cancelled or failed to open print dialog".into());
        }
    }
    Ok(())
}


#[cfg(target_os = "windows")]
#[tauri::command]
fn open_file_print_dialog(path: String) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    let operation: Vec<u16> = OsStr::new("print").encode_wide().chain(Some(0)).collect();
    let file: Vec<u16> = OsStr::new(&path).encode_wide().chain(Some(0)).collect();

    unsafe {
        let result = ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOW,
        );

        if (result as usize) <= 32 {
            return Err(format!("Failed to open print dialog: {:?}", result));
        }
    }
    Ok(())
}

#[tauri::command]
fn open_skins_folder(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    use std::process::Command;

    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?;

    let skins_dir = dir.join("skins");

    std::fs::create_dir_all(&skins_dir).map_err(|e| e.to_string())?;

    // Windows Explorer
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(skins_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    // Linux
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(skins_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    // macOS
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(skins_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// MAIN
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                // Send files to existing window (skip .exe path)
                let files: Vec<String> = argv.iter().skip(1).cloned().collect();
                let _ = window.emit("open-files", files);

                // Restore & focus window
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();

                #[cfg(target_os = "windows")]
                {
                    // Force foreground (Windows quirk)
                    let _ = window.set_always_on_top(true);
                    let _ = window.set_always_on_top(false);
                }
            }
        }))
        .invoke_handler(tauri::generate_handler![
            get_opened_file,
            read_text_file,
            write_text_file,
            reveal_file,
            open_native_print_dialog,
            show_print_dialog,
            open_file_print_dialog,
            open_skins_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
