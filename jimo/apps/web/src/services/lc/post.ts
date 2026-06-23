import request from '../request';

export interface Post {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  cover_image: string | null;
  published_at: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface PostListParams {
  page?: number;
  pageSize?: number;
    title?: string;
    published_at?: string;
    status?: string;
}

export interface PostListResult {
  list: Post[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreatePostDto {
    title: string;
    content: string;
    summary?: string;
    cover_image?: string;
    published_at?: string;
    status: string;
}

export interface UpdatePostDto {
    title?: string;
    content?: string;
    summary?: string;
    cover_image?: string;
    published_at?: string;
    status?: string;
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated posts list.
 */
export async function getPostsList(params?: PostListParams): Promise<PostListResult> {
  return request.get('/lc/posts', { params });
}

/**
 * Get a single post by ID.
 */
export async function getPost(id: string): Promise<Post> {
  return request.get(`/lc/posts/${id}`);
}

/**
 * Create a new post.
 */
export async function createPost(dto: CreatePostDto): Promise<Post> {
  return request.post('/lc/posts', dto);
}

/**
 * Update an existing post.
 */
export async function updatePost(id: string, dto: UpdatePostDto): Promise<Post> {
  return request.patch(`/lc/posts/${id}`, dto);
}

/**
 * Delete a post by ID (soft delete).
 */
export async function deletePost(id: string): Promise<void> {
  return request.delete(`/lc/posts/${id}`);
}

/**
 * Batch delete posts by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeletePosts(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/posts/batch', { data: { ids } });
}

