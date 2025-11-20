/*
  Backend con Express + Oracle
  Sirve index.html y expone /api/registro/:id
*/
const session = require("express-session");
const express = require('express');
const oracledb = require('oracledb');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use(session({
  secret: "MI_SECRETO_LOGIN",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // <- true si usas HTTPS
}));


function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect("/login");
  }
  next();
}
// 1) Servir carpeta PUBLIC (aquí estarán tus HTML)
// =============================================================
app.use(express.static(path.join(__dirname, "public")));


// 2) Rutas HTML
// =============================================================
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "Index.html"));
});

app.get("/busqueda", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "Busqueda_empleados.html"));
});
app.get('/cambiarPass', (req, res) => {
  res.sendFile(path.join(__dirname, "public", "Cambia_pass.html"));
});
app.get('/Busqueda_serial', (req, res) => {
  res.sendFile(path.join(__dirname, "public", "Busqueda_serial.html"));
});
app.get('/mover_flujo', (req, res) => {
  res.sendFile(path.join(__dirname, "public", "Busqueda_serial.html"));
});
app.get("/login", (req, res) => {
  res.sendFile(__dirname + "/public/login.html");
});

// LOGIN — Página pública
// =============================================================
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// LOGOUT
// =============================================================
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});


// LOGIN (POST) — Validación en Oracle
// =============================================================
app.post("/api/login", async (req, res) => {
  const { usuario, password } = req.body;

  if (!usuario || !password)
    return res.json({ status: "error", message: "Faltan datos" });

  let conn;
  try {
    conn = await oracledb.getConnection();

    const sql = `
      SELECT EMP_NO, EMP_PASSWORD
      FROM SFIS1.C_EMP_DESC_T
      WHERE EMP_NO = :u
        AND EMP_PASSWORD = :p
    `;

    const result = await conn.execute(sql, { u: usuario, p: password });

    if (result.rows.length === 0)
      return res.json({ status: "error", message: "Usuario o contraseña incorrectos" });

    req.session.user = usuario;

    res.json({ status: "ok", message: "Bienvenido" });

  } catch (err) {
    console.error(err);
    res.json({ status: "error", message: err.message });
  } finally {
    if (conn) try { await conn.close(); } catch (e) {}
  }
});

// 3) Configuración Oracle
// =============================================================
const dbConfig = {
  user: process.env.ORACLE_USER || 'SFIS1',
  password: process.env.ORACLE_PASSWORD || 'SFIS1',
  connectString: process.env.ORACLE_CONNECT || '10.12.213.112:1600/GDLNVDB'
};
const instantClientDir = 'C:\\Oracle\\instantclient_23_4\\instantclient-basic-windows.x64-19.29.0.0.0dbru\\instantclient_19_29';
function ensureInstantClient(dir) {
  try {
    if (!fs.existsSync(dir)) {
      return { ok: false, msg: `No existe la carpeta de Instant Client: ${dir}` };
    }
    const winFile = path.join(dir, 'oci.dll');
    const linuxFile = path.join(dir, 'libclntsh.so');
    if (!fs.existsSync(winFile) && !fs.existsSync(linuxFile)) {
      return { ok: false, msg: `No se encontró oci.dll ni libclntsh.so en: ${dir}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: e.message || String(e) };
  }
}
try {
  const check = ensureInstantClient(instantClientDir);
  if (!check.ok) {
    console.error('Instant Client no encontrado o incompleto.', check.msg);
  } else {
    oracledb.initOracleClient({ libDir: instantClientDir });
    console.log('oracledb: initOracleClient() OK -> usando modo THICK.');
  }
} catch (err) {
  console.error('Error initOracleClient():', err.message);
  process.exit(1);
}
async function initPool() {
  try {
    await oracledb.createPool({
      user: dbConfig.user,
      password: dbConfig.password,
      connectString: dbConfig.connectString,
      poolMin: 1,
      poolMax: 5,
      poolIncrement: 1
    });
    console.log("Pool de Oracle creado");
  } catch (err) {
    console.error("Error creando pool:", err);
    process.exit(1);
  }
}


// 4) API: /api/registro/:id
// =============================================================
app.get("/api/registro/:id", async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "Falta id" });

  let connection;
  try {
    connection = await oracledb.getConnection();
    const sql = `SELECT * FROM SFIS1.C_EMP_DESC_T WHERE EMP_NO = :id`;
    const result = await connection.execute(sql, { id }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    res.json({ rows: result.rows || [] });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (e) {}
    }
  }
});


// 5) Cerrar pool al salir
// =============================================================
async function closePoolAndExit() {
  try {
    await oracledb.getPool().close(10);
  } catch (_) {}
  process.exit(0);
}

process.once("SIGINT", closePoolAndExit);
process.once("SIGTERM", closePoolAndExit);

// 6) Iniciar servidor
// =============================================================
const port = process.env.PORT || 3000;

initPool().then(() => {
  app.listen(port, () => console.log(`Servidor en: http://localhost:${port}`));
});


// Cambiar contra
// =============================================================
app.post('/api/cambiarPass', async (req, res) => {
  const { emp_no, old_pass, new_pass } = req.body;

  if (!emp_no || !old_pass || !new_pass) {
    return res.status(400).json({ error: "Faltan datos" });
  }

  let conn;
  try {
    conn = await oracledb.getConnection();

    //  Verificar si la contraseña actual es correcta
    const selectSQL = `
      SELECT EMP_PASSWORD 
      FROM SFIS1.C_EMP_DESC_T
      WHERE EMP_NO = :emp_no
    `;
    const result = await conn.execute(
      selectSQL,
      { emp_no },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Empleado no encontrado" });
    }

    const currentPass = result.rows[0].PASSWORD;

    if (currentPass !== old_pass) {
      return res.status(401).json({ error: "La contraseña actual es incorrecta" });
    }

    // 2️⃣ Actualizar la contraseña
    const updateSQL = `
      UPDATE SFIS1.C_EMP_DESC_T
      SET EMP_PASSWORD = :new_pass
      WHERE EMP_NO = :emp_no
    `;

    await conn.execute(updateSQL, { new_pass, emp_no }, { autoCommit: true });

    res.json({ success: true, message: "Contraseña actualizada correctamente" });

  } catch (err) {
    console.error("ERROR:", err);
    res.status(500).json({ error: "Error interno" });
  } finally {
    if (conn) await conn.close();
  }
});

// busqueda multiple flujo SN
// =============================================================
app.post("/api/Busqueda_multiple", async (req, res) => {
  const lista = req.body.seriales;

  if (!lista || lista.length === 0)
    return res.status(400).json({ error: "No hay seriales" });

  let connection;

  try {
    connection = await oracledb.getConnection();

    const sql = `
    SELECT 
    rwtt.SERIAL_NUMBER,
    rwtt.IN_STATION_TIME,
    rwtt.GROUP_NAME AS estacion_actual,
    crnt.GROUP_NEXT AS siguiente_estacion,
    rwtt.MODEL_NAME,
    rwtt.SECTION_FLAG,
    rwtt.ERROR_FLAG,
    rwtt.SPECIAL_ROUTE,
    rwtt.MO_NUMBER,
    rwtt.LINE_NAME,
    NVL(crnt.STEP_SEQUENCE, 0) AS STEP 
   FROM SFISM4.R_WIP_TRACKING_T rwtt
   LEFT JOIN SFIS1.C_ROUTE_CONTROL_T crnt 
    ON rwtt.SPECIAL_ROUTE = crnt.ROUTE_CODE
   AND rwtt.GROUP_NAME = crnt.GROUP_NAME
   AND rwtt.ERROR_FLAG = crnt.STATE_FLAG 
   WHERE rwtt.SERIAL_NUMBER IN (${lista.map((_, i) => `:sn${i}`).join(",")})
    `;

    const binds = {};
    lista.forEach((sn, i) => binds[`sn${i}`] = sn);

    const result = await connection.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT
    });

    res.json({ rows: result.rows });

  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) try { await connection.close(); } catch(e){}
  }
});


// Validación múltiple antes de mover flujo
// =============================================================

app.post("/api/mover_multiple", async (req, res) => {
    const seriales = req.body.seriales;
    const nuevaEstacion = req.body.estacion;

    if (!nuevaEstacion)
        return res.status(400).json({ status: "error", message: "Falta estación" });

    if (!seriales || seriales.length === 0)
        return res.status(400).json({ status: "error", message: "No hay seriales" });

    let connection;

    try {
        connection = await oracledb.getConnection();
        let totalActualizados = 0;
        let errores = [];

        // 1) Opcional pero recomendado: Re-validar en BD que no tengan ERROR_FLAG = 1
        for (const sn of seriales) {
            const rs = await connection.execute(
                `SELECT ERROR_FLAG FROM SFISM4.R_WIP_TRACKING_T WHERE SERIAL_NUMBER = :sn`,
                { sn },
                { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );

            if (rs.rows.length === 0) {
                errores.push({ serial: sn, error: "No encontrado en WIP" });
                continue;
            }

            if (rs.rows[0].ERROR_FLAG == 1) {
                errores.push({ serial: sn, error: `Tiene ERROR_FLAG = 1 y no puede moverse.` });
                continue;
            }
            
            // Si pasa la validación, hacemos el UPDATE
            const sql = `
                UPDATE SFISM4.R_WIP_TRACKING_T
                SET 
                    LINE_NAME = 'SYSTEM',
                    SECTION_NAME = :est,
                    GROUP_NAME = :est,
                    STATION_NAME = :est,
                    IN_STATION_TIME = SYSDATE,
                    ERROR_FLAG = '0'
                WHERE SERIAL_NUMBER = :sn
            `;

            const result = await connection.execute(
                sql, { est: nuevaEstacion, sn },
                { autoCommit: true }
            );

            totalActualizados += result.rowsAffected;
        }

        res.json({
            status: (errores.length === 0) ? "success" : "partial_success",
            message: `Seriales actualizados: ${totalActualizados}/${seriales.length}. Errores: ${errores.length}`,
            errores: errores
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ status: "error", message: err.message });
    } finally {
        if (connection) try { await connection.close(); } catch (e) { }
    }
});


// validacion de ruta
// =============================================================
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
app.get("/api/estaciones_por_ruta/:ruta", async (req, res) => {
 let conn;

 try {
  const ruta = req.params.ruta;
  conn = await oracledb.getConnection(dbConfig);

 const result = await conn.execute(
 `SELECT GROUP_NAME, STEP_SEQUENCE 
 FROM SFIS1.C_ROUTE_CONTROL_T
 WHERE ROUTE_CODE = :ruta
 AND GROUP_NAME NOT LIKE 'R_%'
 ORDER BY STEP_SEQUENCE`, // Ordenar por secuencia
 { ruta }
);


  // Convertir filas en forma uniforme
  const estaciones = result.rows.map(r => ({
   GROUP_NAME: r.GROUP_NAME,
      STEP_SEQUENCE: r.STEP_SEQUENCE || null // Aseguramos que se incluye la secuencia
  }));

  res.json(estaciones);

 } catch (err) {
  console.error(err);
  res.status(500).json({ error: "Error obteniendo estaciones" });
 } finally {
  if (conn) {
   try { await conn.close(); } catch (err) { console.error(err); }
  }
 }
});




