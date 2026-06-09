# Acuerdo Justo Backend

Backend sencillo de autenticacion y administracion de roles con Express, TypeScript y PostgreSQL.

## Funcionalidades actuales

- Registro publico de usuarios.
- Todo usuario registrado inicia con rol `client`.
- Inicio de sesion con usuario y contrasena.
- Autenticacion mediante JWT.
- Roles disponibles: `client`, `legal_advisor` y `admin`.
- El administrador puede consultar usuarios y cambiar sus roles.

## Configuracion

Necesitas tener PostgreSQL instalado localmente o utilizar la URL de una base PostgreSQL alojada.

1. Crea una base de datos llamada `acuerdo_justo`.
2. Copia `.env.example` como `.env`.
3. Ajusta `DATABASE_URL` con tus credenciales de PostgreSQL.
4. Instala las dependencias:

```bash
npm install
```

5. Crea las tablas y el administrador inicial:

```bash
npm run db:migrate
```

6. Inicia el backend:

```bash
npm run dev
```

La API estará disponible en `http://localhost:3000/api`.

## Ejemplo de DATABASE_URL

```env
DATABASE_URL=postgresql://postgres:tu_contrasena@localhost:5432/acuerdo_justo
```

## Usuario inicial

- Usuario: `admin`
- Contrasena: `admin`

Estas credenciales son solo para desarrollo.

## Rutas principales

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:userId/role`
- `GET /api/health`
