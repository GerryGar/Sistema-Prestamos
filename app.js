// ============ VERIFICACIÓN DE AUTENTICACIÓN ============
const auth = firebase.auth();

// Verificar si el usuario está autenticado
auth.onAuthStateChanged((user) => {
    if (!user) {
        // Si no está autenticado, redirigir al login
        window.location.href = 'login.html';
    } else {
        // Si está autenticado, mostrar su nombre
        mostrarUsuario(user);
        // Inicializar el sistema
        inicializarFirebase();
    }
});

// Función para mostrar usuario y botón de cerrar sesión
function mostrarUsuario(user) {
    // Obtener nombre del usuario
    db.collection('usuarios').doc(user.uid).get()
        .then((doc) => {
            if (doc.exists) {
                const userData = doc.data();
                document.getElementById('nombreUsuario').textContent = userData.nombre;
            }
        })
        .catch((error) => {
            console.log('Error al obtener datos del usuario');
        });
}

// Función para cerrar sesión
function cerrarSesion() {
    if (confirm('¿Estás seguro de cerrar sesión?')) {
        auth.signOut().then(() => {
            window.location.href = 'login.html';
        });
    }
}
// ============ VARIABLES GLOBALES ============
let prestamos = [];
let pagos = [];
let isLoading = true;

// ============ ESCUCHAR CAMBIOS EN TIEMPO REAL ============
function inicializarFirebase() {
    // Escuchar préstamos en tiempo real
    db.collection('prestamos').orderBy('fechaInicio', 'desc')
        .onSnapshot((snapshot) => {
            prestamos = [];
            snapshot.forEach((doc) => {
                prestamos.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
            
            if (!isLoading) actualizarTodo();
        }, (error) => {
            console.error('Error al cargar préstamos:', error);
            alert('❌ Error al cargar datos de la nube');
        });

    // Escuchar pagos en tiempo real
    db.collection('pagos').orderBy('fecha', 'desc')
        .onSnapshot((snapshot) => {
            pagos = [];
            snapshot.forEach((doc) => {
                pagos.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
            
            isLoading = false;
            actualizarTodo();
        }, (error) => {
            console.error('Error al cargar pagos:', error);
        });
}

// ============ FUNCIONES CRUD PARA PRÉSTAMOS ============
async function agregarPrestamo(prestamoData) {
    try {
        const docRef = await db.collection('prestamos').add({
            cliente: prestamoData.cliente,
            motivo: prestamoData.motivo,
            monto: prestamoData.monto,
            interes: prestamoData.interes,
            plazo: prestamoData.plazo,
            cuotaMensual: prestamoData.cuotaMensual,
            fechaInicio: prestamoData.fechaInicio,
            fechaVencimiento: prestamoData.fechaVencimiento,
            estado: 'activo',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return docRef.id;
    } catch (error) {
        console.error('Error al agregar préstamo:', error);
        throw error;
    }
}

async function actualizarEstadoPrestamo(prestamoId, estado) {
    try {
        await db.collection('prestamos').doc(prestamoId).update({
            estado: estado,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.error('Error al actualizar préstamo:', error);
        throw error;
    }
}

async function eliminarPrestamoDB(prestamoId) {
    try {
        // Eliminar préstamo
        await db.collection('prestamos').doc(prestamoId).delete();
        
        // Eliminar pagos asociados
        const pagosSnapshot = await db.collection('pagos')
            .where('prestamoId', '==', prestamoId)
            .get();
        
        const batch = db.batch();
        pagosSnapshot.forEach((doc) => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        
    } catch (error) {
        console.error('Error al eliminar préstamo:', error);
        throw error;
    }
}

// ============ FUNCIONES CRUD PARA PAGOS ============
async function agregarPago(pagoData) {
    try {
        await db.collection('pagos').add({
            prestamoId: pagoData.prestamoId,
            monto: pagoData.monto,
            fecha: pagoData.fecha,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        // Verificar si el préstamo está liquidado
        const saldo = calcularSaldoRestante(pagoData.prestamoId);
        if (saldo <= 0) {
            await actualizarEstadoPrestamo(pagoData.prestamoId, 'pagado');
        }
        
    } catch (error) {
        console.error('Error al agregar pago:', error);
        throw error;
    }
}

// ============ FUNCIONES FINANCIERAS ============
function calcularCuotaMensual(monto, interesAnual, plazoMeses) {
    const interesMensual = interesAnual / 100 / 12;
    if (interesMensual === 0) return parseFloat((monto / plazoMeses).toFixed(2));
    
    const cuota = monto * (interesMensual * Math.pow(1 + interesMensual, plazoMeses)) / 
                  (Math.pow(1 + interesMensual, plazoMeses) - 1);
    return parseFloat(cuota.toFixed(2));
}

function calcularFechaVencimiento(fechaInicio, plazoMeses) {
    const fecha = new Date(fechaInicio + 'T00:00:00');
    fecha.setMonth(fecha.getMonth() + plazoMeses);
    return fecha.toISOString().split('T')[0];
}

function calcularSaldoRestante(prestamoId) {
    const prestamo = prestamos.find(p => p.id === prestamoId);
    if (!prestamo) return 0;
    
    const totalPagado = pagos
        .filter(p => p.prestamoId === prestamoId)
        .reduce((sum, p) => sum + p.monto, 0);
    
    const totalDeuda = prestamo.monto + (prestamo.monto * (prestamo.interes / 100) * (prestamo.plazo / 12));
    return parseFloat((totalDeuda - totalPagado).toFixed(2));
}

function formatearFecha(fecha) {
    if (!fecha) return 'No especificada';
    const opciones = { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric'
    };
    return new Date(fecha + 'T00:00:00').toLocaleDateString('es-ES', opciones);
}

// ============ REGISTRO DE PRÉSTAMOS ============
document.getElementById('formPrestamo').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const btnSubmit = this.querySelector('button[type="submit"]');
    const textoOriginal = btnSubmit.innerHTML;
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<i class="bi bi-hourglass-split me-2"></i>Registrando...';
    
    try {
        const monto = parseFloat(document.getElementById('monto').value);
        const interes = parseFloat(document.getElementById('interes').value);
        const plazo = parseInt(document.getElementById('plazo').value);
        const fechaPrestamo = document.getElementById('fechaPrestamo').value;
        
        if (!fechaPrestamo) {
            alert('❌ Por favor selecciona una fecha para el préstamo');
            return;
        }
        
        const prestamoData = {
            cliente: document.getElementById('cliente').value.trim(),
            motivo: document.getElementById('motivo').value.trim(),
            monto: monto,
            interes: interes,
            plazo: plazo,
            cuotaMensual: calcularCuotaMensual(monto, interes, plazo),
            fechaInicio: fechaPrestamo,
            fechaVencimiento: calcularFechaVencimiento(fechaPrestamo, plazo)
        };
        
        await agregarPrestamo(prestamoData);
        
        this.reset();
        document.getElementById('fechaPrestamo').value = new Date().toISOString().split('T')[0];
        
        alert(`✅ Préstamo registrado exitosamente\n` +
              `Cliente: ${prestamoData.cliente}\n` +
              `Cuota mensual: $${prestamoData.cuotaMensual}\n` +
              `Vence: ${formatearFecha(prestamoData.fechaVencimiento)}`);
              
    } catch (error) {
        alert('❌ Error al registrar el préstamo. Intenta de nuevo.');
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = textoOriginal;
    }
});

// ============ REGISTRO DE PAGOS ============
document.getElementById('formPago').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const btnSubmit = this.querySelector('button[type="submit"]');
    const textoOriginal = btnSubmit.innerHTML;
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<i class="bi bi-hourglass-split me-2"></i>Registrando...';
    
    try {
        const prestamoId = document.getElementById('selectPrestamo').value;
        const montoPago = parseFloat(document.getElementById('montoPago').value);
        const fechaPago = document.getElementById('fechaPago').value;
        
        if (!prestamoId || !montoPago) {
            alert('❌ Selecciona un préstamo y un monto válido');
            return;
        }
        
        if (!fechaPago) {
            alert('❌ Por favor selecciona una fecha para el pago');
            return;
        }
        
        const prestamo = prestamos.find(p => p.id === prestamoId);
        
        if (fechaPago < prestamo.fechaInicio) {
            alert('❌ La fecha de pago no puede ser anterior a la fecha del préstamo');
            return;
        }
        
        await agregarPago({
            prestamoId: prestamoId,
            monto: montoPago,
            fecha: fechaPago
        });
        
        this.reset();
        document.getElementById('fechaPago').value = new Date().toISOString().split('T')[0];
        
        const saldo = calcularSaldoRestante(prestamoId);
        alert(`✅ Pago registrado exitosamente\n` +
              `Monto: $${montoPago}\n` +
              `Fecha: ${formatearFecha(fechaPago)}\n` +
              `Saldo restante: $${saldo}`);
              
    } catch (error) {
        alert('❌ Error al registrar el pago. Intenta de nuevo.');
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = textoOriginal;
    }
});

// ============ ACTUALIZACIÓN DE INTERFAZ ============
function actualizarTodo() {
    actualizarEstadisticas();
    actualizarTablaPrestamos();
    actualizarTablaPagos();
    actualizarSelectPrestamos();
}

function actualizarEstadisticas() {
    document.getElementById('totalPrestamos').textContent = prestamos.length;
    
    const totalPrestado = prestamos.reduce((sum, p) => sum + p.monto, 0);
    document.getElementById('totalPrestado').textContent = `$${totalPrestado.toLocaleString()}`;
    
    const totalIntereses = prestamos.reduce((sum, p) => {
        return sum + (p.monto * (p.interes / 100) * (p.plazo / 12));
    }, 0);
    document.getElementById('totalIntereses').textContent = `$${totalIntereses.toLocaleString()}`;
    
    const totalPagado = pagos.reduce((sum, p) => sum + p.monto, 0);
    document.getElementById('totalPagado').textContent = `$${totalPagado.toLocaleString()}`;
}

function actualizarTablaPrestamos() {
    const tbody = document.getElementById('tablaPrestamos');
    tbody.innerHTML = '';
    
    if (isLoading) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-4">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Cargando...</span>
                    </div>
                    <p class="mt-2">Cargando datos desde la nube...</p>
                </td>
            </tr>
        `;
        return;
    }
    
    if (prestamos.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-muted py-4">
                    <i class="bi bi-inbox fs-1"></i>
                    <p>No hay préstamos registrados</p>
                </td>
            </tr>
        `;
        return;
    }
    
    prestamos.forEach(prestamo => {
        const saldo = calcularSaldoRestante(prestamo.id);
        const estadoClass = prestamo.estado === 'activo' ? 'estado-activo' : 'estado-pagado';
        const estadoTexto = prestamo.estado === 'activo' ? 'Activo' : 'Pagado';
        
        const hoy = new Date().toISOString().split('T')[0];
        const vencido = prestamo.estado === 'activo' && prestamo.fechaVencimiento < hoy;
        
        tbody.innerHTML += `
            <tr>
                <td>
                    <strong>${prestamo.cliente}</strong>
                    <br><small class="text-muted">${formatearFecha(prestamo.fechaInicio)}</small>
                </td>
                <td>
                    <small>${prestamo.motivo}</small>
                    ${vencido ? '<br><span class="badge bg-danger">Vencido</span>' : ''}
                </td>
                <td>$${prestamo.monto.toLocaleString()}</td>
                <td>
                    <span class="badge bg-primary">$${prestamo.cuotaMensual}</span>
                    <br><small class="text-muted">Vence: ${formatearFecha(prestamo.fechaVencimiento)}</small>
                </td>
                <td>
                    <span class="badge-estado ${estadoClass}">${estadoTexto}</span>
                </td>
                <td>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-info" onclick="verDetalle('${prestamo.id}')" 
                                title="Ver detalle">
                            <i class="bi bi-eye"></i>
                        </button>
                        <button class="btn btn-outline-success" onclick="generarPDFCliente('${prestamo.id}')" 
                                title="Descargar PDF">
                            <i class="bi bi-file-pdf"></i>
                        </button>
                        <button class="btn btn-outline-danger" onclick="eliminarPrestamo('${prestamo.id}')" 
                                title="Eliminar">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });
}

function actualizarTablaPagos() {
    const tbody = document.getElementById('tablaPagos');
    tbody.innerHTML = '';
    
    if (isLoading) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="text-center py-3">
                    <span class="text-muted">Cargando pagos...</span>
                </td>
            </tr>
        `;
        return;
    }
    
    if (pagos.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="text-center text-muted py-4">
                    <i class="bi bi-cash-stack fs-1"></i>
                    <p>No hay pagos registrados</p>
                </td>
            </tr>
        `;
        return;
    }
    
    const pagosRecientes = pagos.slice(0, 10);
    
    pagosRecientes.forEach(pago => {
        const prestamo = prestamos.find(p => p.id === pago.prestamoId);
        if (!prestamo) return;
        
        const saldo = calcularSaldoRestante(pago.prestamoId);
        
        tbody.innerHTML += `
            <tr>
                <td>
                    <strong>${prestamo.cliente}</strong>
                </td>
                <td>
                    <span class="text-success fw-bold">+$${pago.monto.toLocaleString()}</span>
                </td>
                <td>${formatearFecha(pago.fecha)}</td>
                <td>
                    <span class="badge bg-info">$${saldo.toLocaleString()}</span>
                </td>
            </tr>
        `;
    });
}

function actualizarSelectPrestamos() {
    const select = document.getElementById('selectPrestamo');
    select.innerHTML = '<option value="">Seleccionar préstamo...</option>';
    
    if (isLoading) {
        select.innerHTML += '<option value="" disabled>Cargando...</option>';
        return;
    }
    
    const prestamosActivos = prestamos.filter(p => p.estado === 'activo');
    
    if (prestamosActivos.length === 0) {
        select.innerHTML += '<option value="" disabled>No hay préstamos activos</option>';
        return;
    }
    
    prestamosActivos.forEach(prestamo => {
        const saldo = calcularSaldoRestante(prestamo.id);
        select.innerHTML += `
            <option value="${prestamo.id}">
                ${prestamo.cliente} - Saldo: $${saldo} | Vence: ${formatearFecha(prestamo.fechaVencimiento)}
            </option>
        `;
    });
}

// ============ FUNCIONES DE ACCIÓN ============
function verDetalle(id) {
    const prestamo = prestamos.find(p => p.id === id);
    if (!prestamo) return;
    
    const pagosPrestamo = pagos.filter(p => p.prestamoId === id);
    const totalPagado = pagosPrestamo.reduce((sum, p) => sum + p.monto, 0);
    const saldo = calcularSaldoRestante(id);
    
    let mensaje = `
📋 DETALLE DEL PRÉSTAMO

👤 Cliente: ${prestamo.cliente}
📝 Motivo: ${prestamo.motivo}
💰 Monto: $${prestamo.monto.toLocaleString()}
📊 Interés: ${prestamo.interes}% anual
⏱️ Plazo: ${prestamo.plazo} meses
💳 Cuota mensual: $${prestamo.cuotaMensual}
📅 Fecha préstamo: ${formatearFecha(prestamo.fechaInicio)}
📅 Fecha vencimiento: ${formatearFecha(prestamo.fechaVencimiento)}
📊 Estado: ${prestamo.estado === 'activo' ? 'Activo' : 'Pagado'}

💵 Total pagado: $${totalPagado.toLocaleString()}
🏦 Saldo restante: $${saldo}

📜 Historial de pagos (${pagosPrestamo.length} pagos):
    `;
    
    if (pagosPrestamo.length > 0) {
        pagosPrestamo.forEach(pago => {
            mensaje += `\n   • $${pago.monto} - ${formatearFecha(pago.fecha)}`;
        });
    } else {
        mensaje += '\n   • Sin pagos registrados';
    }
    
    mensaje += '\n\n¿Deseas descargar el PDF de este préstamo?';
    
    if (confirm(mensaje)) {
        generarPDFCliente(id);
    }
}

async function eliminarPrestamo(id) {
    if (confirm('¿Estás seguro de eliminar este préstamo y todos sus pagos?\n\n⚠️ Esta acción no se puede deshacer')) {
        try {
            await eliminarPrestamoDB(id);
            alert('✅ Préstamo eliminado exitosamente');
        } catch (error) {
            alert('❌ Error al eliminar el préstamo');
        }
    }
}

// ============ FUNCIONES DE PDF (Mantener las existentes) ============
// Aquí van todas las funciones de PDF que ya tienes:
// exportarPDF(), seleccionarClientePDF(), generarPDFGeneral(), generarPDFCliente()

// ============ INDICADOR DE CONEXIÓN ============
function mostrarEstadoConexion() {
    const conexionDiv = document.createElement('div');
    conexionDiv.id = 'estadoConexion';
    conexionDiv.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 10px 20px;
        border-radius: 25px;
        background: white;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        z-index: 9999;
        font-size: 0.9rem;
        display: flex;
        align-items: center;
        gap: 8px;
    `;
    
    window.addEventListener('online', () => {
        conexionDiv.innerHTML = '🟢 <strong>En línea</strong> - Datos sincronizados';
        setTimeout(() => conexionDiv.style.opacity = '0', 3000);
    });
    
    window.addEventListener('offline', () => {
        conexionDiv.innerHTML = '🔴 <strong>Sin conexión</strong> - Modo offline';
        conexionDiv.style.opacity = '1';
    });
    
    document.body.appendChild(conexionDiv);
}

// ============ INICIALIZACIÓN ============
document.addEventListener('DOMContentLoaded', function() {
    // Inicializar fechas
    const fechaActual = new Date().toISOString().split('T')[0];
    document.getElementById('fechaPrestamo').value = fechaActual;
    document.getElementById('fechaPago').value = fechaActual;
    
    // Inicializar Firebase
    inicializarFirebase();
    
    // Mostrar indicador de conexión
    mostrarEstadoConexion();
});