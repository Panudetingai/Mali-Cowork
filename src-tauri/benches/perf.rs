//! Criterion benchmarks + workloads that show up well on CPU flame graphs.
//!
//! Run: `cargo bench --bench perf` (from `src-tauri`)
//! Flame graph on Windows: `pwsh ../scripts/profile-rust-bench.ps1`

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use mali_cowork_lib::bench::{is_recursive, is_tool_list_rejection, unsupported};
use serde_json::json;

/// Naive merge sort (allocates each split) — useful to practice reading flame graphs.
fn merge_sort(v: &mut [i32]) {
    if v.len() <= 1 {
        return;
    }
    let len = v.len();
    let mid = len / 2;
    let (left, right) = v.split_at_mut(mid);
    merge_sort(left);
    merge_sort(right);
    let mut merged = Vec::with_capacity(len);
    let mut l = 0;
    let mut r = 0;
    while l < left.len() && r < right.len() {
        if left[l] <= right[r] {
            merged.push(left[l]);
            l += 1;
        } else {
            merged.push(right[r]);
            r += 1;
        }
    }
    merged.extend_from_slice(&left[l..]);
    merged.extend_from_slice(&right[r..]);
    v.copy_from_slice(&merged);
}

fn rive_layout_editor_schema() -> serde_json::Value {
    json!({
        "type": "object",
        "properties": {
            "data": { "properties": { "createLayout": { "properties": {
                "tree": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "children": {
                            "type": "array",
                            "items": { "$ref": "#/properties/data/properties/createLayout/properties/tree" }
                        }
                    }
                }
            }}}}
        }
    })
}

fn bench_merge_sort(c: &mut Criterion) {
    let mut group = c.benchmark_group("merge_sort");
    for size in [1_024, 8_192, 32_768] {
        group.bench_with_input(BenchmarkId::from_parameter(size), &size, |b, &size| {
            b.iter(|| {
                let mut data: Vec<i32> = (0..size).rev().collect();
                merge_sort(black_box(&mut data));
            });
        });
    }
    group.finish();
}

fn bench_schema(c: &mut Criterion) {
    let recursive = rive_layout_editor_schema();
    let plain = json!({
        "type": "object",
        "properties": {
            "path": { "type": "string" },
            "lines": { "type": "array", "items": { "type": "string" } },
            "mode": { "enum": ["read", "write"] }
        },
        "required": ["path"]
    });
    let rejection = "* GenerateContentRequest.tools[0].function_declarations[26].parameters\
        .properties[operations].items.any_of[8].properties[formatting]\
        .properties[link].any_of[0].enum[0]: cannot be empty";

    c.bench_function("schema/is_recursive_recursive", |b| {
        b.iter(|| is_recursive(black_box(&recursive)));
    });
    c.bench_function("schema/is_recursive_plain", |b| {
        b.iter(|| is_recursive(black_box(&plain)));
    });
    c.bench_function("schema/unsupported_google", |b| {
        b.iter(|| unsupported(black_box(&recursive), black_box(true)));
    });
    c.bench_function("schema/is_tool_list_rejection", |b| {
        b.iter(|| is_tool_list_rejection(black_box(rejection)));
    });
}

criterion_group!(benches, bench_merge_sort, bench_schema);
criterion_main!(benches);
