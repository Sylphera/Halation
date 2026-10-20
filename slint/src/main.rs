#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(error) = halation_slint::run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
