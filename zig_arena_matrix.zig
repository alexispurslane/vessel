// Zig: Arena Allocator and Matrix Math Example
const std = @import("std");

// Simple 4x4 matrix for transformations
const Mat4 = struct {
    data: [16]f32,

    fn identity() Mat4 {
        return Mat4{ .data = [16]f32{
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
        }};
    }

    fn translation(x: f32, y: f32, z: f32) Mat4 {
        var m = Mat4.identity();
        m.data[12] = x;
        m.data[13] = y;
        m.data[14] = z;
        return m;
    }

    fn scale(x: f32, y: f32, z: f32) Mat4 {
        var m = Mat4.identity();
        m.data[0] = x;
        m.data[5] = y;
        m.data[10] = z;
        return m;
    }

    fn multiply(a: Mat4, b: Mat4) Mat4 {
        var result: Mat4 = undefined;
        for (0..4) |row| {
            for (0..4) |col| {
                var sum: f32 = 0;
                for (0..4) |k| {
                    sum += a.data[row * 4 + k] * b.data[k * 4 + col];
                }
                result.data[row * 4 + col] = sum;
            }
        }
        return result;
    }
};

// Using the arena allocator
pub fn main() void {
    // Initialize the arena allocator
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();

    const allocator = arena.allocator();

    // Allocate a matrix using the arena
    const mat1 = allocator.create(Mat4) catch unreachable;
    mat1.* = Mat4.translation(1.0, 2.0, 3.0);

    const mat2 = allocator.create(Mat4) catch unreachable;
    mat2.* = Mat4.scale(2.0, 2.0, 2.0);

    // Multiply matrices - result also allocated from arena
    const result = allocator.create(Mat4) catch unreachable;
    result.* = Mat4.multiply(mat1.*, mat2.*);

    // Print result
    std.debug.print("Zig Matrix Result (translation * scale):\n", .{});
    for (0..4) |row| {
        std.debug.print("[{d:.2}] [{d:.2}] [{d:.2}] [{d:.2}]\n", .{
            result.data[row * 4 + 0],
            result.data[row * 4 + 1],
            result.data[row * 4 + 2],
            result.data[row * 4 + 3],
        });
    }

    // Arena automatically frees all allocated memory at the end
    std.debug.print("\nAll memory freed automatically!\n", .{});
}