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

// ============ REGISTRO DE PAGOS (ACTUALIZADO) ============
document.getElementById('formPago').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const btnSubmit = this.querySelector('button[type="submit"]');
    const textoOriginal = btnSubmit.innerHTML;
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<i class="bi bi-hourglass-split me-2"></i>Registrando...';
    
    try {
        const clienteSeleccionado = document.getElementById('selectClientePago').value;
        const prestamoId = document.getElementById('selectPrestamo').value;
        const montoPago = parseFloat(document.getElementById('montoPago').value);
        const fechaPago = document.getElementById('fechaPago').value;
        
        if (!clienteSeleccionado) {
            alert('❌ Por favor selecciona un cliente');
            return;
        }
        
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
        document.getElementById('selectPrestamo').disabled = true;
        document.getElementById('selectPrestamo').innerHTML = '<option value="">Primero selecciona un cliente...</option>';
        document.getElementById('infoPrestamo').style.display = 'none';
        
        const saldo = calcularSaldoRestante(prestamoId);
        
        // Mostrar ticket automáticamente
        const ultimoPago = pagos.find(p => 
            p.prestamoId === prestamoId && 
            p.monto === montoPago && 
            p.fecha === fechaPago
        );
        
        if (ultimoPago && confirm('✅ Pago registrado exitosamente\n\n¿Deseas imprimir el comprobante?')) {
            generarTicket(ultimoPago.id);
        } else {
            alert(`✅ Pago registrado exitosamente\n\n` +
                  `Cliente: ${prestamo.cliente}\n` +
                  `Préstamo: ${prestamo.motivo}\n` +
                  `Monto: $${montoPago.toLocaleString()}\n` +
                  `Saldo restante: $${saldo.toLocaleString()}`);
        }
              
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
    actualizarSelectClientesPago();
    actualizarSelectPrestamos();
    actualizarGraficos();
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
        const clienteEscapado = prestamo.cliente.replace(/'/g, "\\'");
        
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
                                title="Descargar PDF individual">
                            <i class="bi bi-file-pdf"></i>
                        </button>
                        <button class="btn btn-outline-warning" 
                                onclick="generarPDFClienteCompleto('${clienteEscapado}')" 
                                title="PDF completo del cliente">
                            <i class="bi bi-file-earmark-pdf"></i>
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
                <td colspan="5" class="text-center py-3">
                    <span class="text-muted">Cargando pagos...</span>
                </td>
            </tr>
        `;
        return;
    }
    
    if (pagos.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center text-muted py-4">
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
                <td>
                    <button class="btn-ticket" onclick="generarTicket('${pago.id}')" 
                            title="Imprimir comprobante">
                        <i class="bi bi-receipt me-1"></i>Ticket
                    </button>
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
// ============ NUEVAS FUNCIONES PARA SELECTOR DE PAGOS ============

function actualizarSelectClientesPago() {
    const select = document.getElementById('selectClientePago');
    if (!select) return;
    
    select.innerHTML = '<option value="">Seleccionar cliente...</option>';
    
    if (isLoading) {
        select.innerHTML += '<option value="" disabled>Cargando...</option>';
        return;
    }
    
    // Obtener clientes únicos con préstamos activos
    const clientesUnicos = [...new Set(
        prestamos
            .filter(p => p.estado === 'activo')
            .map(p => p.cliente)
    )].sort();
    
    if (clientesUnicos.length === 0) {
        select.innerHTML += '<option value="" disabled>No hay clientes con préstamos activos</option>';
        return;
    }
    
    clientesUnicos.forEach(cliente => {
        const prestamosCliente = prestamos.filter(p => p.cliente === cliente && p.estado === 'activo');
        select.innerHTML += `
            <option value="${cliente.replace(/"/g, '&quot;')}">
                ${cliente} (${prestamosCliente.length} préstamos activos)
            </option>
        `;
    });
}

function actualizarSelectPrestamosPorCliente(clienteSeleccionado) {
    const select = document.getElementById('selectPrestamo');
    const infoDiv = document.getElementById('infoPrestamo');
    
    if (!select) return;
    
    // Limpiar
    select.innerHTML = '<option value="">Seleccionar préstamo...</option>';
    select.disabled = true;
    
    // Ocultar info
    if (infoDiv) infoDiv.style.display = 'none';
    
    if (!clienteSeleccionado) {
        select.innerHTML = '<option value="">Primero selecciona un cliente...</option>';
        return;
    }
    
    // Habilitar selector
    select.disabled = false;
    
    // Filtrar préstamos activos del cliente
    const prestamosCliente = prestamos.filter(p => 
        p.cliente === clienteSeleccionado && p.estado === 'activo'
    );
    
    if (prestamosCliente.length === 0) {
        select.innerHTML = '<option value="">No hay préstamos activos</option>';
        return;
    }
    
    prestamosCliente.forEach(prestamo => {
        const saldo = calcularSaldoRestante(prestamo.id);
        select.innerHTML += `
            <option value="${prestamo.id}">
                ${prestamo.motivo} - Saldo: $${saldo.toLocaleString()} | Cuota: $${prestamo.cuotaMensual.toLocaleString()}
            </option>
        `;
    });
}

function mostrarInfoPrestamo(prestamoId) {
    const infoDiv = document.getElementById('infoPrestamo');
    if (!infoDiv) return;
    
    if (!prestamoId) {
        infoDiv.style.display = 'none';
        return;
    }
    
    const prestamo = prestamos.find(p => p.id === prestamoId);
    if (!prestamo) {
        infoDiv.style.display = 'none';
        return;
    }
    
    const saldo = calcularSaldoRestante(prestamoId);
    
    document.getElementById('infoCuota').textContent = `$${prestamo.cuotaMensual.toLocaleString()}`;
    document.getElementById('infoSaldo').textContent = `$${parseFloat(saldo).toLocaleString()}`;
    infoDiv.style.display = 'block';
}

// ============ EVENTOS DE LOS SELECTORES DE PAGO ============

// Cuando se selecciona un cliente
document.getElementById('selectClientePago').addEventListener('change', function() {
    const clienteSeleccionado = this.value;
    actualizarSelectPrestamosPorCliente(clienteSeleccionado);
});

// Cuando se selecciona un préstamo específico
document.getElementById('selectPrestamo').addEventListener('change', function() {
    const prestamoId = this.value;
    mostrarInfoPrestamo(prestamoId);
});

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
// ============ FUNCIONES DE PDF ============

function exportarPDF() {
    if (prestamos.length === 0) {
        alert('❌ No hay préstamos para generar el reporte');
        return;
    }
    
    const opcion = prompt(
        'SELECCIONA EL TIPO DE REPORTE:\n\n' +
        '1 = Reporte general (todos los préstamos)\n' +
        '2 = Reporte de un cliente (préstamo individual)\n' +
        '3 = Reporte COMPLETO de un cliente (todos sus préstamos)\n\n' +
        'Ingresa el número de la opción:'
    );
    
    switch(opcion) {
        case '1':
            generarPDFGeneral();
            break;
        case '2':
            seleccionarClientePDF();
            break;
        case '3':
            seleccionarClienteParaPDF();
            break;
        default:
            if (opcion === null) return;
            alert('❌ Opción no válida');
    }
}

function seleccionarClientePDF() {
    if (prestamos.length === 0) {
        alert('❌ No hay préstamos registrados');
        return;
    }
    
    let listaClientes = 'SELECCIONA EL CLIENTE:\n\n';
    prestamos.forEach((p, index) => {
        listaClientes += `${index + 1}. ${p.cliente} - $${p.monto.toLocaleString()} - ${p.estado}\n`;
    });
    
    const seleccion = prompt(listaClientes + '\nIngresa el número del cliente:');
    
    if (seleccion && !isNaN(seleccion)) {
        const index = parseInt(seleccion) - 1;
        if (prestamos[index]) {
            generarPDFCliente(prestamos[index].id);
        } else {
            alert('❌ Número de cliente inválido');
        }
    }
}

function seleccionarClienteParaPDF() {
    if (prestamos.length === 0) {
        alert('❌ No hay préstamos registrados');
        return;
    }
    
    const clientesUnicos = [...new Set(prestamos.map(p => p.cliente))];
    
    let listaClientes = 'SELECCIONA EL CLIENTE:\n\n';
    clientesUnicos.forEach((cliente, index) => {
        const prestamosCliente = prestamos.filter(p => p.cliente === cliente);
        listaClientes += `${index + 1}. ${cliente} (${prestamosCliente.length} préstamos)\n`;
    });
    
    const seleccion = prompt(listaClientes + '\nIngresa el número del cliente:');
    
    if (seleccion && !isNaN(seleccion)) {
        const index = parseInt(seleccion) - 1;
        if (clientesUnicos[index]) {
            generarPDFClienteCompleto(clientesUnicos[index]);
        } else {
            alert('❌ Número de cliente inválido');
        }
    }
}

function generarPDFClienteCompleto(nombreCliente) {
    try {
        const prestamosCliente = prestamos.filter(p => p.cliente === nombreCliente);
        
        if (prestamosCliente.length === 0) {
            alert('❌ No se encontraron préstamos para este cliente');
            return;
        }
        
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        const pageWidth = doc.internal.pageSize.width;
        
        // ===== ENCABEZADO =====
        doc.setFillColor(37, 99, 235);
        doc.rect(0, 0, pageWidth, 45, 'F');
        
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text('REPORTE DE COMPRAS', pageWidth / 2, 22, { align: 'center' });
        
        doc.setFontSize(14);
        doc.setFont('helvetica', 'normal');
        doc.text(`Cliente: ${nombreCliente}`, pageWidth / 2, 35, { align: 'center' });
        
        // ===== RESUMEN GENERAL DEL CLIENTE =====
        let yPos = 55;
        doc.setTextColor(0, 0, 0);
        
        const totalPrestado = prestamosCliente.reduce((sum, p) => sum + p.monto, 0);
        const totalIntereses = prestamosCliente.reduce((sum, p) => {
            return sum + (p.monto * (p.interes / 100) * (p.plazo / 12));
        }, 0);
        const totalPagar = totalPrestado + totalIntereses;
        
        let totalPagado = 0;
        prestamosCliente.forEach(prestamo => {
            totalPagado += pagos
                .filter(p => p.prestamoId === prestamo.id)
                .reduce((sum, p) => sum + p.monto, 0);
        });
        
        const saldoTotal = totalPagar - totalPagado;
        const prestamosActivos = prestamosCliente.filter(p => p.estado === 'activo').length;
        const prestamosPagados = prestamosCliente.filter(p => p.estado === 'pagado').length;
        
        doc.setFillColor(240, 245, 255);
        doc.rect(14, yPos, pageWidth - 28, 40, 'F');
        
        yPos += 8;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(37, 99, 235);
        doc.text('RESUMEN GENERAL DEL CLIENTE', 20, yPos);
        
        yPos += 8;
        doc.setFontSize(9);
        doc.setTextColor(0, 0, 0);
        
        doc.setFont('helvetica', 'normal');
        doc.text(`Total de préstamos: ${prestamosCliente.length}`, 20, yPos);
        doc.text(`Activos: ${prestamosActivos}`, 80, yPos);
        doc.text(`Pagados: ${prestamosPagados}`, 120, yPos);
        doc.text(`Total prestado: $${totalPrestado.toLocaleString()}`, 160, yPos);
        
        yPos += 6;
        doc.text(`Intereses generados: $${totalIntereses.toLocaleString()}`, 20, yPos);
        doc.text(`Total a pagar: $${totalPagar.toLocaleString()}`, 80, yPos);
        
        yPos += 6;
        doc.setFont('helvetica', 'bold');
        doc.text(`Total pagado: $${totalPagado.toLocaleString()}`, 20, yPos);
        doc.text(`Saldo pendiente: $${saldoTotal.toLocaleString()}`, 80, yPos);
        
        const porcentajePagado = totalPagar > 0 ? ((totalPagado / totalPagar) * 100).toFixed(1) : '0.0';
        doc.text(`Progreso: ${porcentajePagado}%`, 140, yPos);
        
        // ===== TABLA RESUMEN DE PRÉSTAMOS =====
        yPos += 15;
        
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(37, 99, 235);
        doc.text('LISTADO DE COMPRAS', 20, yPos);
        
        yPos += 8;
        
        const tableData = prestamosCliente.map(p => {
            const pagosPrestamo = pagos.filter(pg => pg.prestamoId === p.id);
            const totalPagadoPrestamo = pagosPrestamo.reduce((sum, pg) => sum + pg.monto, 0);
            const saldoPrestamo = parseFloat(calcularSaldoRestante(p.id));
            
            return [
                p.motivo.length > 30 ? p.motivo.substring(0, 30) + '...' : p.motivo,
                `$${p.monto.toLocaleString()}`,
                `${p.interes}%`,
                `${p.plazo} meses`,
                `$${p.cuotaMensual.toLocaleString()}`,
                formatearFecha(p.fechaInicio),
                `$${totalPagadoPrestamo.toLocaleString()}`,
                `$${saldoPrestamo.toLocaleString()}`,
                p.estado === 'activo' ? 'Activo' : 'Pagado'
            ];
        });
        
        doc.autoTable({
            startY: yPos,
            head: [['Motivo', 'Monto', 'Interés', 'Plazo', 'Cuota', 'Inicio', 'Pagado', 'Saldo', 'Estado']],
            body: tableData,
            theme: 'grid',
            headStyles: {
                fillColor: [37, 99, 235],
                textColor: [255, 255, 255],
                fontSize: 8,
                fontStyle: 'bold',
                halign: 'center'
            },
            bodyStyles: {
                fontSize: 7,
                textColor: [50, 50, 50]
            },
            alternateRowStyles: {
                fillColor: [245, 247, 250]
            }
        });
        
        // ===== PIE DE PÁGINA =====
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setDrawColor(200, 200, 200);
            doc.line(14, 280, pageWidth - 14, 280);
            doc.setFontSize(8);
            doc.setTextColor(128, 128, 128);
            doc.text(`Reporte generado el ${new Date().toLocaleDateString('es-ES')}`, 20, 285);
            doc.text(`Cliente: ${nombreCliente}`, pageWidth / 2, 285, { align: 'center' });
            doc.text(`Página ${i} de ${pageCount}`, pageWidth - 20, 285, { align: 'right' });
        }
        
        const nombreArchivo = nombreCliente.toLowerCase().replace(/\s+/g, '-');
        doc.save(`prestamos-${nombreArchivo}-${new Date().toISOString().split('T')[0]}.pdf`);
        alert('✅ PDF del cliente generado exitosamente');
        
    } catch (error) {
        console.error('Error al generar PDF:', error);
        alert('❌ Error al generar el PDF.');
    }
}

function generarPDFGeneral() {
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.width;
        
        doc.setFillColor(37, 99, 235);
        doc.rect(0, 0, pageWidth, 40, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text('REPORTE GENERAL DE PRÉSTAMOS', pageWidth / 2, 25, { align: 'center' });
        
        let yPos = 50;
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        
        const fechaReporte = new Date().toLocaleDateString('es-ES', {
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        
        doc.text(`Fecha: ${fechaReporte}`, 14, yPos);
        doc.text(`Total préstamos: ${prestamos.length}`, 14, yPos + 7);
        
        const tableData = prestamos.map(p => [
            p.cliente,
            p.motivo.length > 25 ? p.motivo.substring(0, 25) + '...' : p.motivo,
            `$${p.monto.toLocaleString()}`,
            `${p.interes}%`,
            `${p.plazo} meses`,
            `$${p.cuotaMensual.toLocaleString()}`,
            formatearFecha(p.fechaInicio),
            p.estado === 'activo' ? 'Activo' : 'Pagado'
        ]);
        
        doc.autoTable({
            startY: yPos + 15,
            head: [['Cliente', 'Motivo', 'Monto', 'Interés', 'Plazo', 'Cuota', 'Inicio', 'Estado']],
            body: tableData,
            theme: 'grid',
            headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
            bodyStyles: { fontSize: 7 }
        });
        
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(128, 128, 128);
            doc.text(`Página ${i} de ${pageCount}`, pageWidth - 20, 285, { align: 'right' });
        }
        
        doc.save(`reporte-general-${new Date().toISOString().split('T')[0]}.pdf`);
        alert('✅ PDF general generado exitosamente');
        
    } catch (error) {
        console.error('Error:', error);
        alert('❌ Error al generar el PDF.');
    }
}

function generarPDFCliente(prestamoId) {
    try {
        const prestamo = prestamos.find(p => p.id === prestamoId);
        if (!prestamo) { alert('❌ Préstamo no encontrado'); return; }
        
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.width;
        
        doc.setFillColor(37, 99, 235);
        doc.rect(0, 0, pageWidth, 45, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text('REPORTE DE COMPRAS', pageWidth / 2, 22, { align: 'center' });
        doc.setFontSize(14);
        doc.setFont('helvetica', 'normal');
        doc.text(`Cliente: ${prestamo.cliente}`, pageWidth / 2, 35, { align: 'center' });
        
        let yPos = 55;
        doc.setTextColor(0, 0, 0);
        doc.setDrawColor(37, 99, 235);
        doc.setLineWidth(0.5);
        doc.rect(14, yPos, pageWidth - 28, 85);
        
        yPos += 8;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text('INFORMACIÓN DE LAS COMPRAS', 20, yPos);
        yPos += 8;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        
        const datos = [
            ['Cliente:', prestamo.cliente],
            ['Motivo:', prestamo.motivo],
            ['Monto original:', `$${prestamo.monto.toLocaleString()}`],
            ['Tasa de interés:', `${prestamo.interes}% anual`],
            ['Plazo:', `${prestamo.plazo} meses`],
            ['Cuota mensual:', `$${prestamo.cuotaMensual.toLocaleString()}`],
            ['Fecha de inicio:', formatearFecha(prestamo.fechaInicio)],
            ['Fecha de vencimiento:', formatearFecha(prestamo.fechaVencimiento)],
            ['Estado:', prestamo.estado === 'activo' ? 'ACTIVO' : 'PAGADO']
        ];
        
        datos.forEach(([label, value]) => {
            yPos += 7;
            doc.setFont('helvetica', 'bold');
            doc.text(label, 20, yPos);
            doc.setFont('helvetica', 'normal');
            doc.text(value.toString(), 80, yPos);
        });
        
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(128, 128, 128);
            doc.text(`Página ${i} de ${pageCount}`, pageWidth - 20, 285, { align: 'right' });
        }
        
        const nombreArchivo = prestamo.cliente.toLowerCase().replace(/\s+/g, '-');
        doc.save(`prestamo-${nombreArchivo}-${new Date().toISOString().split('T')[0]}.pdf`);
        alert('✅ PDF del cliente generado exitosamente');
        
    } catch (error) {
        console.error('Error:', error);
        alert('❌ Error al generar el PDF.');
    }
}

// ============ SISTEMA DE TICKETS ============
function generarTicket(pagoId) {
    const pago = pagos.find(p => p.id === pagoId);
    if (!pago) { alert('❌ Pago no encontrado'); return; }
    
    const prestamo = prestamos.find(p => p.id === pago.prestamoId);
    if (!prestamo) { alert('❌ Préstamo no encontrado'); return; }
    
    const saldoRestante = calcularSaldoRestante(prestamo.id);
    const ticketHTML = crearTicketHTML(pago, prestamo, saldoRestante);
    
    document.getElementById('ticketContainer').innerHTML = ticketHTML;
    document.getElementById('ticketOverlay').classList.add('activo');
}

function crearTicketHTML(pago, prestamo, saldoRestante) {
    const numeroTicket = generarNumeroTicket(pago.id);
    const fechaPago = new Date(pago.fecha + 'T00:00:00');
    const fechaFormateada = fechaPago.toLocaleDateString('es-ES', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const horaFormateada = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    
    const pagosAnteriores = pagos
        .filter(p => p.prestamoId === prestamo.id && p.id <= pago.id)
        .reduce((sum, p) => sum + p.monto, 0);
    
    return `
        <div class="ticket-header">
            <div class="logo">💰</div>
            <h3>Comprobante de Pago</h3>
            <small>Ticket #${numeroTicket}</small>
        </div>
        <div class="ticket-body">
            <div class="ticket-info">
                <div class="fila"><span class="label">Fecha:</span><span class="value">${fechaFormateada}</span></div>
                <div class="fila"><span class="label">Hora:</span><span class="value">${horaFormateada}</span></div>
                <div class="fila"><span class="label">Cliente:</span><span class="value">${prestamo.cliente}</span></div>
                <div class="fila"><span class="label">Préstamo:</span><span class="value">${prestamo.motivo}</span></div>
            </div>
            <div class="ticket-monto">
                <div class="monto-label">MONTO RECIBIDO</div>
                <div class="monto-recibido">$${pago.monto.toLocaleString()}</div>
            </div>
            <div class="ticket-info">
                <div class="fila"><span class="label">Total pagado:</span><span class="value text-success">$${pagosAnteriores.toLocaleString()}</span></div>
                <div class="fila"><span class="label">Saldo pendiente:</span><span class="value text-danger">$${parseFloat(saldoRestante).toLocaleString()}</span></div>
            </div>
        </div>
        <div class="ticket-footer">Gracias por su preferencia</div>
        <div class="ticket-acciones">
            <button class="btn-imprimir" onclick="imprimirTicket()"><i class="bi bi-printer me-2"></i>Imprimir</button>
            <button class="btn-cerrar-ticket" onclick="cerrarTicket()"><i class="bi bi-x-lg me-2"></i>Cerrar</button>
        </div>
    `;
}

function generarNumeroTicket(pagoId) {
    const numero = Math.abs(hashCode(pagoId.toString())).toString().substring(0, 8);
    return `TKT-${new Date().getFullYear()}-${numero.padStart(6, '0')}`;
}

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash;
}

function imprimirTicket() { window.print(); }

function cerrarTicket() { document.getElementById('ticketOverlay').classList.remove('activo'); }

document.addEventListener('keydown', function(e) { if (e.key === 'Escape') cerrarTicket(); });

document.getElementById('ticketOverlay').addEventListener('click', function(e) { if (e.target === this) cerrarTicket(); });

// ============ SISTEMA DE GRÁFICOS ============
let periodoActual = 'mes';
let graficosInstancia = {};

function cambiarPeriodo(periodo, boton) {
    periodoActual = periodo;
    document.querySelectorAll('.btn-periodo').forEach(btn => btn.classList.remove('activo'));
    boton.classList.add('activo');
    actualizarGraficos();
}

function actualizarGraficos() {
    if (isLoading) return;
    actualizarResumenCards();
    crearGraficoIngresos();
    crearGraficoDistribucion();
    crearGraficoComparativa();
}

function actualizarResumenCards() {
    const container = document.getElementById('resumenCards');
    if (!container) return;
    
    const { fechaInicio, fechaFin } = obtenerRangoFechas(periodoActual);
    
    const pagosPeriodo = pagos.filter(p => p.fecha >= fechaInicio && p.fecha <= fechaFin);
    const prestamosPeriodo = prestamos.filter(p => p.fechaInicio >= fechaInicio && p.fechaInicio <= fechaFin);
    
    const totalIngresos = pagosPeriodo.reduce((sum, p) => sum + p.monto, 0);
    const totalPrestado = prestamosPeriodo.reduce((sum, p) => sum + p.monto, 0);
    const totalIntereses = prestamosPeriodo.reduce((sum, p) => sum + (p.monto * (p.interes / 100) * (p.plazo / 12)), 0);
    const gananciaNeta = totalIngresos + totalIntereses;
    const prestamosActivos = prestamos.filter(p => p.estado === 'activo').length;
    
    container.innerHTML = `
        <div class="resumen-card"><div class="icono">💰</div><div class="etiqueta">Ingresos del Período</div><div class="valor" style="color: #10b981;">$${totalIngresos.toLocaleString()}</div><div class="tendencia tendencia-positiva">↑ Pagos recibidos</div></div>
        <div class="resumen-card"><div class="icono">📈</div><div class="etiqueta">Préstamos Nuevos</div><div class="valor" style="color: #2563eb;">$${totalPrestado.toLocaleString()}</div><div class="tendencia">${prestamosPeriodo.length} préstamos</div></div>
        <div class="resumen-card"><div class="icono">💎</div><div class="etiqueta">Ganancia Neta</div><div class="valor" style="color: #8b5cf6;">$${gananciaNeta.toLocaleString()}</div><div class="tendencia tendencia-positiva">Capital + Intereses</div></div>
        <div class="resumen-card"><div class="icono">📊</div><div class="etiqueta">Préstamos Activos</div><div class="valor" style="color: #f59e0b;">${prestamosActivos}</div><div class="tendencia">Por cobrar</div></div>
    `;
}

function crearGraficoIngresos() {
    const ctx = document.getElementById('graficoIngresos');
    if (!ctx) return;
    if (graficosInstancia.ingresos) graficosInstancia.ingresos.destroy();
    
    const { labels, datasets } = prepararDatosIngresos();
    
    graficosInstancia.ingresos = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Ingresos por Pagos',
                data: datasets.ingresos,
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } }
        }
    });
}

function crearGraficoDistribucion() {
    const ctx = document.getElementById('graficoDistribucion');
    if (!ctx) return;
    if (graficosInstancia.distribucion) graficosInstancia.distribucion.destroy();
    
    const activos = prestamos.filter(p => p.estado === 'activo').length;
    const pagados = prestamos.filter(p => p.estado === 'pagado').length;
    
    graficosInstancia.distribucion = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Activos', 'Pagados'],
            datasets: [{ data: [activos, pagados], backgroundColor: ['rgba(37, 99, 235, 0.8)', 'rgba(16, 185, 129, 0.8)'] }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function crearGraficoComparativa() {
    const ctx = document.getElementById('graficoComparativa');
    if (!ctx) return;
    if (graficosInstancia.comparativa) graficosInstancia.comparativa.destroy();
    
    const { labels, datasets } = prepararDatosComparativa();
    
    graficosInstancia.comparativa = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'Préstamos Otorgados', data: datasets.prestamos, backgroundColor: 'rgba(37, 99, 235, 0.8)' },
                { label: 'Pagos Recibidos', data: datasets.pagos, backgroundColor: 'rgba(16, 185, 129, 0.8)' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function obtenerRangoFechas(periodo) {
    const hoy = new Date();
    let fechaInicio, fechaFin;
    
    switch(periodo) {
        case 'mes':
            fechaInicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
            fechaFin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
            break;
        case 'trimestre':
            const trimestreActual = Math.floor(hoy.getMonth() / 3);
            fechaInicio = new Date(hoy.getFullYear(), trimestreActual * 3, 1);
            fechaFin = new Date(hoy.getFullYear(), (trimestreActual + 1) * 3, 0);
            break;
        case 'anio':
            fechaInicio = new Date(hoy.getFullYear(), 0, 1);
            fechaFin = new Date(hoy.getFullYear(), 11, 31);
            break;
    }
    
    return {
        fechaInicio: fechaInicio.toISOString().split('T')[0],
        fechaFin: fechaFin.toISOString().split('T')[0]
    };
}

function prepararDatosIngresos() {
    const { fechaInicio, fechaFin } = obtenerRangoFechas(periodoActual);
    let labels = [];
    let datosIngresos = [];
    
    const pagosFiltrados = pagos.filter(p => p.fecha >= fechaInicio && p.fecha <= fechaFin);
    
    if (periodoActual === 'mes') {
        const diasEnMes = new Date(fechaFin).getDate();
        for (let i = 1; i <= diasEnMes; i++) {
            const dia = i.toString().padStart(2, '0');
            labels.push(`Día ${dia}`);
            const totalDia = pagosFiltrados.filter(p => p.fecha.endsWith(`-${dia}`)).reduce((sum, p) => sum + p.monto, 0);
            datosIngresos.push(totalDia);
        }
    } else {
        const mesesLabels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        const inicio = new Date(fechaInicio);
        const fin = new Date(fechaFin);
        
        for (let m = inicio.getMonth(); m <= fin.getMonth(); m++) {
            labels.push(mesesLabels[m]);
            const totalMes = pagosFiltrados.filter(p => new Date(p.fecha + 'T00:00:00').getMonth() === m).reduce((sum, p) => sum + p.monto, 0);
            datosIngresos.push(totalMes);
        }
    }
    
    return { labels: labels, datasets: { ingresos: datosIngresos } };
}

function prepararDatosComparativa() {
    const { fechaInicio, fechaFin } = obtenerRangoFechas(periodoActual);
    let labels = [];
    let datosPrestamos = [];
    let datosPagos = [];
    
    if (periodoActual === 'mes') {
        labels = ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4'];
        const inicio = new Date(fechaInicio + 'T00:00:00');
        
        for (let s = 0; s < 4; s++) {
            const inicioSemana = new Date(inicio);
            inicioSemana.setDate(inicio.getDate() + (s * 7));
            const finSemana = new Date(inicioSemana);
            finSemana.setDate(inicioSemana.getDate() + 6);
            
            const prestamosSemana = prestamos.filter(p => { const fecha = new Date(p.fechaInicio + 'T00:00:00'); return fecha >= inicioSemana && fecha <= finSemana; }).reduce((sum, p) => sum + p.monto, 0);
            const pagosSemana = pagos.filter(p => { const fecha = new Date(p.fecha + 'T00:00:00'); return fecha >= inicioSemana && fecha <= finSemana; }).reduce((sum, p) => sum + p.monto, 0);
            
            datosPrestamos.push(prestamosSemana);
            datosPagos.push(pagosSemana);
        }
    } else {
        const mesesLabels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        const inicio = new Date(fechaInicio);
        const fin = new Date(fechaFin);
        
        for (let m = inicio.getMonth(); m <= fin.getMonth(); m++) {
            labels.push(mesesLabels[m]);
            const prestamosMes = prestamos.filter(p => new Date(p.fechaInicio + 'T00:00:00').getMonth() === m).reduce((sum, p) => sum + p.monto, 0);
            const pagosMes = pagos.filter(p => new Date(p.fecha + 'T00:00:00').getMonth() === m).reduce((sum, p) => sum + p.monto, 0);
            datosPrestamos.push(prestamosMes);
            datosPagos.push(pagosMes);
        }
    }
    
    return { labels: labels, datasets: { prestamos: datosPrestamos, pagos: datosPagos } };
}

// ============ INDICADOR DE CONEXIÓN ============
function mostrarEstadoConexion() {
    const conexionDiv = document.createElement('div');
    conexionDiv.id = 'estadoConexion';
    conexionDiv.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:10px 20px;border-radius:25px;background:white;box-shadow:0 4px 15px rgba(0,0,0,0.2);z-index:9999;font-size:0.9rem;display:flex;align-items:center;gap:8px;';
    
    window.addEventListener('online', () => { conexionDiv.innerHTML = '🟢 <strong>En línea</strong> - Datos sincronizados'; setTimeout(() => conexionDiv.style.opacity = '0', 3000); });
    window.addEventListener('offline', () => { conexionDiv.innerHTML = '🔴 <strong>Sin conexión</strong> - Modo offline'; conexionDiv.style.opacity = '1'; });
    
    document.body.appendChild(conexionDiv);
}

// ============ INICIALIZACIÓN ============
document.addEventListener('DOMContentLoaded', function() {
    const fechaActual = new Date().toISOString().split('T')[0];
    document.getElementById('fechaPrestamo').value = fechaActual;
    document.getElementById('fechaPago').value = fechaActual;
    mostrarEstadoConexion();
});