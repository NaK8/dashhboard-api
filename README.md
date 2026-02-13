# Medical Dashboard API

Bun + Hono + Drizzle + PostgreSQL backend for receiving WordPress Metform submissions and serving them to a TanStack dashboard.

## Architecture

```
WordPress (Metform) → Webhook → Bun API → PostgreSQL → Dashboard (TanStack)
```

## API Routes

### Public
| Method | Route             | Description              |
|--------|-------------------|--------------------------|
| GET    | /                 | API health check         |
| GET    | /webhook/health   | Webhook health check     |
| POST   | /webhook/metform  | Receive Metform submissions (webhook secret auth) |

### Auth
| Method | Route                | Description          |
|--------|----------------------|----------------------|
| POST   | /auth/login          | Login → returns JWT  |
| GET    | /auth/me             | Get current user     |
| POST   | /auth/change-password| Change password      |

### Submissions (JWT required)
| Method | Route              | Description                        |
|--------|--------------------|------------------------------------|
| GET    | /submissions       | List with filters & pagination     |
| GET    | /submissions/stats | Dashboard summary counts           |
| GET    | /submissions/:id   | Single submission with audit trail  |
| PATCH  | /submissions/:id   | Update status / assignment / notes |
| DELETE | /submissions/:id   | Delete (admin only)                |

### Staff (Admin only)
| Method | Route       | Description          |
|--------|-------------|----------------------|
| GET    | /staff      | List all staff       |
| POST   | /staff      | Create staff member  |
| PATCH  | /staff/:id  | Update staff member  |
| DELETE | /staff/:id  | Deactivate staff     |

## Setup on Hostinger VPS

### 1. Install Prerequisites

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Install PostgreSQL
sudo apt install postgresql postgresql-contrib -y
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### 2. Setup PostgreSQL

```bash
# Switch to postgres user
sudo -u postgres psql

# Inside psql:
CREATE USER dashboard_user WITH PASSWORD 'your_strong_password_here';
CREATE DATABASE medical_dashboard OWNER dashboard_user;
GRANT ALL PRIVILEGES ON DATABASE medical_dashboard TO dashboard_user;
\q
```

### 3. Clone & Install

```bash
cd /opt
git clone <your-repo-url> medical-dashboard-api
cd medical-dashboard-api
bun install
```

### 4. Configure Environment

```bash
cp .env.example .env
nano .env

# Fill in:
# DATABASE_URL=postgresql://dashboard_user:your_strong_password_here@localhost:5432/medical_dashboard
# JWT_SECRET=<generate-a-64-char-random-string>
# WEBHOOK_SECRET=<generate-another-secret>
# DASHBOARD_URL=https://dashboard.yourdomain.com
```

### 5. Run Migrations & Seed

```bash
bun run db:generate
bun run db:migrate
bun run db:seed
```

### 6. Test Locally

```bash
bun run dev

# In another terminal:
curl http://localhost:3000/
curl http://localhost:3000/webhook/health
```

### 7. Setup as systemd Service

```bash
sudo nano /etc/systemd/system/medical-api.service
```

Paste:

```ini
[Unit]
Description=Medical Dashboard API
After=network.target postgresql.service

[Service]
Type=simple
User=your-username
WorkingDirectory=/opt/medical-dashboard-api
ExecStart=/home/your-username/.bun/bin/bun run src/index.ts
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/opt/medical-dashboard-api/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable medical-api
sudo systemctl start medical-api

# Check status
sudo systemctl status medical-api
journalctl -u medical-api -f
```

### 8. Nginx Reverse Proxy

```bash
sudo apt install nginx -y
sudo nano /etc/nginx/sites-available/api.yourdomain.com
```

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/api.yourdomain.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# SSL with Certbot
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d api.yourdomain.com
```

## WordPress Metform Webhook Setup

### Option A: Using Metform Pro Webhook
1. Go to **Metform → Forms → Edit your form**
2. Look for **Integration → Webhook** in form settings
3. Set webhook URL: `https://api.yourdomain.com/webhook/metform`
4. Set method: **POST**
5. Add custom header: `x-webhook-secret: your-webhook-secret-key`

### Option B: Using WP Webhooks Plugin
1. Install **WP Webhooks** plugin
2. Go to **Settings → WP Webhooks → Send Data**
3. Add new webhook trigger on **Metform Submission**
4. Webhook URL: `https://api.yourdomain.com/webhook/metform`
5. Add header: `x-webhook-secret: your-webhook-secret-key`

### Option C: Custom Code Snippet (Code Snippets Plugin)
Add this PHP snippet:

```php
add_action('metform_after_store_form_data', function($form_id, $form_data) {
    $webhook_url = 'https://api.yourdomain.com/webhook/metform';

    $payload = array_merge($form_data, [
        'form_id'        => $form_id,
        'form_name'      => get_the_title($form_id),
        'entry_id'       => uniqid('mf_'),
        'webhook_secret' => 'your-webhook-secret-key',
    ]);

    wp_remote_post($webhook_url, [
        'headers' => [
            'Content-Type'     => 'application/json',
            'x-webhook-secret' => 'your-webhook-secret-key',
        ],
        'body'    => json_encode($payload),
        'timeout' => 15,
    ]);
}, 10, 2);
```

## Testing the Webhook

```bash
# Simulate a Metform submission
curl -X POST https://api.yourdomain.com/webhook/metform \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: your-webhook-secret-key" \
  -d '{
    "form_id": "blood-test-form",
    "form_name": "Complete Blood Count",
    "entry_id": "test-001",
    "patient_name": "John Doe",
    "patient_email": "john@example.com",
    "patient_phone": "+1234567890",
    "blood_type": "O+",
    "test_date": "2025-02-08"
  }'
```

## Dashboard TanStack Query Integration

Example of how your dashboard fetches data:

```typescript
// api.ts
const API_BASE = "https://api.yourdomain.com";

export const api = {
  async fetch(path: string, options?: RequestInit) {
    const token = localStorage.getItem("token");
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options?.headers,
      },
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  getSubmissions: (params: URLSearchParams) =>
    api.fetch(`/submissions?${params}`),

  getSubmission: (id: number) =>
    api.fetch(`/submissions/${id}`),

  updateSubmission: (id: number, data: any) =>
    api.fetch(`/submissions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  getStats: () => api.fetch("/submissions/stats"),

  login: (email: string, password: string) =>
    api.fetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
};

// hooks.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export function useSubmissions(filters: Record<string, string>) {
  const params = new URLSearchParams(filters);
  return useQuery({
    queryKey: ["submissions", filters],
    queryFn: () => api.getSubmissions(params),
    refetchInterval: 5000, // Poll every 5 seconds for near-realtime
  });
}

export function useUpdateSubmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      api.updateSubmission(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["submissions"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
```
