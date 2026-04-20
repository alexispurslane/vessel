// Odin: Arena Allocator and Matrix Math Example
package main

import "core:fmt"
import "core:mem"

// Simple 4x4 matrix for transformations
Mat4 :: struct {
    data: [16]f32,
}

mat4_identity :: proc() -> Mat4 {
    return Mat4{data = [16]f32{
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    }};
}

mat4_translation :: proc(x, y, z: f32) -> Mat4 {
    m := mat4_identity();
    m.data[12] = x;
    m.data[13] = y;
    m.data[14] = z;
    return m;
}

mat4_scale :: proc(x, y, z: f32) -> Mat4 {
    m := mat4_identity();
    m.data[0] = x;
    m.data[5] = y;
    m.data[10] = z;
    return m;
}

mat4_multiply :: proc(a, b: Mat4) -> Mat4 {
    result: Mat4;
    for row := 0; row < 4; row += 1 {
        for col := 0; col < 4; col += 1 {
            sum: f32 = 0;
            for k := 0; k < 4; k += 1 {
                sum += a.data[row * 4 + k] * b.data[k * 4 + col];
            }
            result.data[row * 4 + col] = sum;
        }
    }
    return result;
}

// Using the arena allocator
main :: proc() {
    // Initialize the arena allocator
    arena: mem.Arena;
    // Using context.allocator for simplicity, but can use a custom arena directly
    mem.arena_init(&arena, make([]byte, 1024 * 1024)); // 1MB arena
    defer mem.arena_free_all(&arena);

    allocator := mem.arena_allocator(&arena);

    // Allocate a matrix using the arena
    mat1 := new(Mat4, allocator);
    mat1^ = mat4_translation(1.0, 2.0, 3.0);

    mat2 := new(Mat4, allocator);
    mat2^ = mat4_scale(2.0, 2.0, 2.0);

    // Multiply matrices - result also allocated from arena
    result := new(Mat4, allocator);
    result^ = mat4_multiply(mat1^, mat2^);

    // Print result
    fmt.println("Odin Matrix Result (translation * scale):");
    for row := 0; row < 4; row += 1 {
        fmt.printf("[%.2f] [%.2f] [%.2f] [%.2f]\n",
            result.data[row * 4 + 0],
            result.data[row * 4 + 1],
            result.data[row * 4 + 2],
            result.data[row * 4 + 3],
        );
    }

    // Arena automatically frees all allocated memory at the end
    fmt.println("\nAll memory freed automatically!");
}