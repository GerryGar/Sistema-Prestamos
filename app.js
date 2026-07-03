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
        
         // Mostrar ticket automáticamente
        const ultimoPago = pagos[pagos.length - 1];
            if (confirm('✅ Pago registrado exitosamente\n\n¿Deseas imprimir el comprobante?')) {
            generarTicket(ultimoPago.id);
        } else {
        alert(`Monto: $${montoPago.toLocaleString()}\nSaldo restante: $${saldo.toLocaleString()}`);
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
                            title="Descargar PDF individual">
                            <i class="bi bi-file-pdf"></i>
                        </button>
                            <button class="btn btn-outline-warning" 
                            onclick="generarPDFClienteCompleto('${prestamo.cliente.replace(/'/g, "\\'")}')" 
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
// ============ FUNCIONES DE PDF ============    
       function exportarPDF() {
        if (prestamos.length === 0) {
            alert('❌ No hay préstamos para generar el reporte');
            return;
    }
    
    // Crear menú de opciones mejorado
    const opcion = prompt(
        'SELECCIONA EL TIPO DE REPORTE:\n\n' +
        '1 = Reporte general (todos los préstamos)\n' +
        '2 = Reporte de un cliente específico (préstamo individual)\n' +
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
            if (opcion === null) return; // Cancelar
            alert('❌ Opción no válida. Intenta de nuevo.');
            exportarPDF(); // Volver a preguntar
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

function generarPDFGeneral() {
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        const pageWidth = doc.internal.pageSize.width;
        
        // ===== ENCABEZADO =====
        doc.setFillColor(37, 99, 235);
        doc.rect(0, 0, pageWidth, 40, 'F');
        
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text('REPORTE GENERAL DE PRÉSTAMOS', pageWidth / 2, 25, { align: 'center' });
        
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.text('Sistema Profesional de Préstamos', pageWidth / 2, 34, { align: 'center' });
        
        // ===== INFORMACIÓN DEL REPORTE =====
        let yPos = 50;
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        
        const fechaReporte = new Date().toLocaleDateString('es-ES', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        doc.text(`Fecha de emisión: ${fechaReporte}`, 14, yPos);
        doc.text(`Total de préstamos: ${prestamos.length}`, 14, yPos + 7);
        
        const totalPrestado = prestamos.reduce((sum, p) => sum + p.monto, 0);
        const totalIntereses = prestamos.reduce((sum, p) => {
            return sum + (p.monto * (p.interes / 100) * (p.plazo / 12));
        }, 0);
        
        doc.text(`Capital total: $${totalPrestado.toLocaleString()}`, 14, yPos + 14);
        doc.text(`Intereses totales: $${totalIntereses.toLocaleString()}`, 100, yPos + 14);
        
        // ===== ESTADÍSTICAS =====
        yPos += 25;
        doc.setFillColor(240, 245, 255);
        doc.rect(14, yPos, pageWidth - 28, 20, 'F');
        
        const activos = prestamos.filter(p => p.estado === 'activo').length;
        const pagados = prestamos.filter(p => p.estado === 'pagado').length;
        
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'bold');
        doc.text(`Préstamos Activos: ${activos}`, 20, yPos + 8);
        doc.text(`Préstamos Pagados: ${pagados}`, 100, yPos + 8);
        doc.text(`Total: ${prestamos.length}`, 160, yPos + 8);
        
        // ===== TABLA DE PRÉSTAMOS =====
        yPos += 30;
        
        const tableData = prestamos.map(p => [
            p.cliente,
            p.motivo.length > 25 ? p.motivo.substring(0, 25) + '...' : p.motivo,
            `$${p.monto.toLocaleString()}`,
            `${p.interes}%`,
            `${p.plazo} meses`,
            `$${p.cuotaMensual.toLocaleString()}`,
            formatearFecha(p.fechaInicio),
            formatearFecha(p.fechaVencimiento),
            p.estado === 'activo' ? 'Activo' : 'Pagado'
        ]);
        
        doc.autoTable({
            startY: yPos,
            head: [['Cliente', 'Motivo', 'Monto', 'Interés', 'Plazo', 'Cuota', 'Inicio', 'Vence', 'Estado']],
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
            },
            columnStyles: {
                0: { cellWidth: 22 },
                1: { cellWidth: 30 },
                2: { cellWidth: 18, halign: 'right' },
                3: { cellWidth: 13, halign: 'center' },
                4: { cellWidth: 13, halign: 'center' },
                5: { cellWidth: 18, halign: 'right' },
                6: { cellWidth: 20, halign: 'center' },
                7: { cellWidth: 20, halign: 'center' },
                8: { cellWidth: 14, halign: 'center' }
            },
            margin: { top: 10 }
        });
        
        // ===== PIE DE PÁGINA =====
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            
            doc.setDrawColor(200, 200, 200);
            doc.line(14, 280, pageWidth - 14, 280);
            
            doc.setFontSize(8);
            doc.setTextColor(128, 128, 128);
            doc.text('Sistema de Préstamos - Documento confidencial', pageWidth / 2, 285, { align: 'center' });
            doc.text(`Página ${i} de ${pageCount}`, pageWidth - 20, 285, { align: 'right' });
        }
        
        // Guardar PDF
        doc.save(`reporte-general-${new Date().toISOString().split('T')[0]}.pdf`);
        alert('✅ PDF general generado exitosamente');
        
    } catch (error) {
        console.error('Error al generar PDF:', error);
        alert('❌ Error al generar el PDF. Verifica que las librerías estén cargadas correctamente.');
    }
}

function generarPDFCliente(prestamoId) {
    try {
        const prestamo = prestamos.find(p => p.id === prestamoId);
        if (!prestamo) {
            alert('❌ Préstamo no encontrado');
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
        doc.text(`Cliente: ${prestamo.cliente}`, pageWidth / 2, 35, { align: 'center' });
        
        // ===== DATOS DEL PRÉSTAMO =====
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
        
        // ===== RESUMEN FINANCIERO =====
        yPos += 15;
        const pagosPrestamo = pagos.filter(p => p.prestamoId === prestamoId);
        const totalPagado = pagosPrestamo.reduce((sum, p) => sum + p.monto, 0);
        const saldoRestante = parseFloat(calcularSaldoRestante(prestamoId));
        const interesTotal = prestamo.monto * (prestamo.interes / 100) * (prestamo.plazo / 12);
        const totalPagar = prestamo.monto + interesTotal;
        
        doc.setFillColor(240, 245, 255);
        doc.rect(14, yPos, pageWidth - 28, 35, 'F');
        
        yPos += 8;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(37, 99, 235);
        doc.text('RESUMEN FINANCIERO', 20, yPos);
        
        yPos += 8;
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        
        doc.setFont('helvetica', 'normal');
        doc.text(`Capital: $${prestamo.monto.toLocaleString()}`, 20, yPos);
        doc.text(`Intereses: $${interesTotal.toLocaleString()}`, 80, yPos);
        doc.text(`Total a pagar: $${totalPagar.toLocaleString()}`, 140, yPos);
        
        yPos += 7;
        doc.setFont('helvetica', 'bold');
        doc.text(`Pagado: $${totalPagado.toLocaleString()}`, 20, yPos);
        doc.text(`Saldo: $${saldoRestante.toLocaleString()}`, 80, yPos);
        
        const porcentaje = ((totalPagado / totalPagar) * 100).toFixed(1);
        doc.text(`Progreso: ${porcentaje}%`, 140, yPos);
        
        // ===== HISTORIAL DE PAGOS =====
        yPos += 20;
        
        if (pagosPrestamo.length > 0) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(12);
            doc.setTextColor(37, 99, 235);
            doc.text('HISTORIAL DE PAGOS', 20, yPos);
            
            yPos += 8;
            
            const tableData = pagosPrestamo.map((pago, index) => [
                (index + 1).toString(),
                `$${pago.monto.toLocaleString()}`,
                formatearFecha(pago.fecha)
            ]);
            
            doc.autoTable({
                startY: yPos,
                head: [['#', 'Monto Pagado', 'Fecha']],
                body: tableData,
                theme: 'grid',
                headStyles: {
                    fillColor: [37, 99, 235],
                    textColor: [255, 255, 255],
                    fontSize: 10,
                    fontStyle: 'bold',
                    halign: 'center'
                },
                bodyStyles: {
                    fontSize: 9,
                    textColor: [50, 50, 50]
                },
                alternateRowStyles: {
                    fillColor: [245, 247, 250]
                },
                columnStyles: {
                    0: { cellWidth: 15, halign: 'center' },
                    1: { cellWidth: 60, halign: 'right' },
                    2: { cellWidth: 60, halign: 'center' }
                }
            });
        } else {
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(11);
            doc.setTextColor(128, 128, 128);
            doc.text('Sin pagos registrados hasta la fecha', 20, yPos);
        }
        
        // ===== PIE DE PÁGINA =====
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            
            doc.setDrawColor(200, 200, 200);
            doc.line(14, 280, pageWidth - 14, 280);
            
            doc.setFontSize(8);
            doc.setTextColor(128, 128, 128);
            doc.text(`Reporte generado el ${new Date().toLocaleDateString('es-ES')}`, 20, 285);
            doc.text(`Página ${i} de ${pageCount}`, pageWidth - 20, 285, { align: 'right' });
        }
        
        // Guardar PDF
        const nombreCliente = prestamo.cliente.toLowerCase().replace(/\s+/g, '-');
        doc.save(`prestamo-${nombreCliente}-${new Date().toISOString().split('T')[0]}.pdf`);
        alert('✅ PDF del cliente generado exitosamente');
        
    } catch (error) {
        console.error('Error al generar PDF:', error);
        alert('❌ Error al generar el PDF. Verifica que las librerías estén cargadas correctamente.');
    }
}
// ============ NUEVA FUNCIÓN: PDF POR CLIENTE ============

function seleccionarClienteParaPDF() {
    if (prestamos.length === 0) {
        alert('❌ No hay préstamos registrados');
        return;
    }
    
    // Obtener lista de clientes únicos
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
        doc.text('REPORTE DE PRÉSTAMOS', pageWidth / 2, 22, { align: 'center' });
        
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
        
        // Calcular total pagado de todos los préstamos
        let totalPagado = 0;
        prestamosCliente.forEach(prestamo => {
            totalPagado += pagos
                .filter(p => p.prestamoId === prestamo.id)
                .reduce((sum, p) => sum + p.monto, 0);
        });
        
        const saldoTotal = totalPagar - totalPagado;
        const prestamosActivos = prestamosCliente.filter(p => p.estado === 'activo').length;
        const prestamosPagados = prestamosCliente.filter(p => p.estado === 'pagado').length;
        
        // Cuadro de resumen
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
        
        const porcentajePagado = ((totalPagado / totalPagar) * 100).toFixed(1);
        doc.text(`Progreso: ${porcentajePagado}%`, 140, yPos);
        
        // ===== TABLA RESUMEN DE PRÉSTAMOS =====
        yPos += 15;
        
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(37, 99, 235);
        doc.text('LISTADO DE PRÉSTAMOS', 20, yPos);
        
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
            },
            columnStyles: {
                0: { cellWidth: 35 },
                1: { cellWidth: 18, halign: 'right' },
                2: { cellWidth: 13, halign: 'center' },
                3: { cellWidth: 15, halign: 'center' },
                4: { cellWidth: 18, halign: 'right' },
                5: { cellWidth: 20, halign: 'center' },
                6: { cellWidth: 18, halign: 'right' },
                7: { cellWidth: 18, halign: 'right' },
                8: { cellWidth: 14, halign: 'center' }
            }
        });
        
        // ===== DETALLE DE CADA PRÉSTAMO =====
        prestamosCliente.forEach((prestamo, index) => {
            doc.addPage();
            
            const pagosPrestamo = pagos
                .filter(p => p.prestamoId === prestamo.id)
                .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
            
            // Encabezado de préstamo
            doc.setFillColor(59, 130, 246);
            doc.rect(0, 0, pageWidth, 30, 'F');
            
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text(`Préstamo #${index + 1}: ${prestamo.motivo}`, pageWidth / 2, 20, { align: 'center' });
            
            let yPosPrestamo = 40;
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(10);
            
            // Datos del préstamo
            const datosPrestamo = [
                ['Motivo:', prestamo.motivo],
                ['Monto original:', `$${prestamo.monto.toLocaleString()}`],
                ['Tasa de interés:', `${prestamo.interes}% anual`],
                ['Plazo:', `${prestamo.plazo} meses`],
                ['Cuota mensual:', `$${prestamo.cuotaMensual.toLocaleString()}`],
                ['Fecha inicio:', formatearFecha(prestamo.fechaInicio)],
                ['Fecha vencimiento:', formatearFecha(prestamo.fechaVencimiento)],
                ['Estado:', prestamo.estado === 'activo' ? 'ACTIVO' : 'PAGADO']
            ];
            
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.text('Datos del Préstamo', 20, yPosPrestamo);
            
            yPosPrestamo += 8;
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            
            datosPrestamo.forEach(([label, value]) => {
                yPosPrestamo += 6;
                doc.setFont('helvetica', 'bold');
                doc.text(label, 20, yPosPrestamo);
                doc.setFont('helvetica', 'normal');
                doc.text(value.toString(), 75, yPosPrestamo);
            });
            
            // Resumen financiero del préstamo
            yPosPrestamo += 12;
            const totalPagadoPrestamo = pagosPrestamo.reduce((sum, p) => sum + p.monto, 0);
            const totalPagarPrestamo = prestamo.monto + (prestamo.monto * (prestamo.interes / 100) * (prestamo.plazo / 12));
            
            doc.setFillColor(240, 245, 255);
            doc.rect(14, yPosPrestamo, pageWidth - 28, 20, 'F');
            
            yPosPrestamo += 8;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(37, 99, 235);
            doc.text('Resumen Financiero', 20, yPosPrestamo);
            
            yPosPrestamo += 6;
            doc.setFontSize(9);
            doc.setTextColor(0, 0, 0);
            doc.setFont('helvetica', 'normal');
            doc.text(`Total prestado: $${prestamo.monto.toLocaleString()}`, 20, yPosPrestamo);
            doc.text(`Total a pagar: $${totalPagarPrestamo.toLocaleString()}`, 90, yPosPrestamo);
            doc.setFont('helvetica', 'bold');
            doc.text(`Pagado: $${totalPagadoPrestamo.toLocaleString()}`, 150, yPosPrestamo);
            
            // Historial de pagos del préstamo
            yPosPrestamo += 15;
            
            if (pagosPrestamo.length > 0) {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(11);
                doc.setTextColor(37, 99, 235);
                doc.text('Historial de Pagos', 20, yPosPrestamo);
                
                yPosPrestamo += 6;
                
                const pagosData = pagosPrestamo.map((pago, i) => [
                    (i + 1).toString(),
                    `$${pago.monto.toLocaleString()}`,
                    formatearFecha(pago.fecha)
                ]);
                
                doc.autoTable({
                    startY: yPosPrestamo,
                    head: [['#', 'Monto', 'Fecha']],
                    body: pagosData,
                    theme: 'grid',
                    headStyles: {
                        fillColor: [37, 99, 235],
                        textColor: [255, 255, 255],
                        fontSize: 9,
                        fontStyle: 'bold',
                        halign: 'center'
                    },
                    bodyStyles: {
                        fontSize: 8,
                        textColor: [50, 50, 50]
                    },
                    alternateRowStyles: {
                        fillColor: [245, 247, 250]
                    },
                    columnStyles: {
                        0: { cellWidth: 15, halign: 'center' },
                        1: { cellWidth: 50, halign: 'right' },
                        2: { cellWidth: 50, halign: 'center' }
                    }
                });
            } else {
                doc.setFont('helvetica', 'italic');
                doc.setFontSize(10);
                doc.setTextColor(128, 128, 128);
                doc.text('Sin pagos registrados', 20, yPosPrestamo);
            }
        });
        
        // ===== PIE DE PÁGINA EN TODAS LAS HOJAS =====
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
        
        // Guardar PDF
        const nombreArchivo = nombreCliente.toLowerCase().replace(/\s+/g, '-');
        doc.save(`prestamos-${nombreArchivo}-${new Date().toISOString().split('T')[0]}.pdf`);
        alert('✅ PDF del cliente generado exitosamente');
        
    } catch (error) {
        console.error('Error al generar PDF:', error);
        alert('❌ Error al generar el PDF. Verifica las librerías.');
    }
}

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
// ============ SISTEMA DE GRÁFICOS ============
let periodoActual = 'mes';
let graficosInstancia = {};

// Función para cambiar período
function cambiarPeriodo(periodo, boton) {
    periodoActual = periodo;
    
    // Actualizar botones activos
    document.querySelectorAll('.btn-periodo').forEach(btn => {
        btn.classList.remove('activo');
    });
    boton.classList.add('activo');
    
    // Actualizar gráficos
    actualizarGraficos();
}

// Función principal para actualizar todos los gráficos
function actualizarGraficos() {
    if (isLoading) return;
    
    actualizarResumenCards();
    crearGraficoIngresos();
    crearGraficoDistribucion();
    crearGraficoComparativa();
}

// Actualizar cards de resumen
function actualizarResumenCards() {
    const container = document.getElementById('resumenCards');
    if (!container) return;
    
    const { fechaInicio, fechaFin } = obtenerRangoFechas(periodoActual);
    
    // Calcular métricas del período
    const pagosPeriodo = pagos.filter(p => {
        return p.fecha >= fechaInicio && p.fecha <= fechaFin;
    });
    
    const prestamosPeriodo = prestamos.filter(p => {
        return p.fechaInicio >= fechaInicio && p.fechaInicio <= fechaFin;
    });
    
    const totalIngresos = pagosPeriodo.reduce((sum, p) => sum + p.monto, 0);
    const totalPrestado = prestamosPeriodo.reduce((sum, p) => sum + p.monto, 0);
    const totalIntereses = prestamosPeriodo.reduce((sum, p) => {
        return sum + (p.monto * (p.interes / 100) * (p.plazo / 12));
    }, 0);
    
    const gananciaNeta = totalIngresos + totalIntereses;
    const prestamosActivos = prestamos.filter(p => p.estado === 'activo').length;
    
    container.innerHTML = `
        <div class="resumen-card">
            <div class="icono">💰</div>
            <div class="etiqueta">Ingresos del Período</div>
            <div class="valor" style="color: #10b981;">$${totalIngresos.toLocaleString()}</div>
            <div class="tendencia tendencia-positiva">↑ Pagos recibidos</div>
        </div>
        
        <div class="resumen-card">
            <div class="icono">📈</div>
            <div class="etiqueta">Préstamos Nuevos</div>
            <div class="valor" style="color: #2563eb;">$${totalPrestado.toLocaleString()}</div>
            <div class="tendencia">${prestamosPeriodo.length} préstamos</div>
        </div>
        
        <div class="resumen-card">
            <div class="icono">💎</div>
            <div class="etiqueta">Ganancia Neta</div>
            <div class="valor" style="color: #8b5cf6;">$${gananciaNeta.toLocaleString()}</div>
            <div class="tendencia tendencia-positiva">Capital + Intereses</div>
        </div>
        
        <div class="resumen-card">
            <div class="icono">📊</div>
            <div class="etiqueta">Préstamos Activos</div>
            <div class="valor" style="color: #f59e0b;">${prestamosActivos}</div>
            <div class="tendencia">Por cobrar</div>
        </div>
    `;
}

// Gráfico 1: Ingresos por Pagos (Línea temporal)
function crearGraficoIngresos() {
    const ctx = document.getElementById('graficoIngresos');
    if (!ctx) return;
    
    // Destruir gráfico anterior si existe
    if (graficosInstancia.ingresos) {
        graficosInstancia.ingresos.destroy();
    }
    
    const { fechaInicio, fechaFin, labels, datasets } = prepararDatosIngresos();
    
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
                fill: true,
                pointBackgroundColor: '#2563eb',
                pointBorderColor: 'white',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` $${context.parsed.y.toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '$' + value.toLocaleString();
                        }
                    }
                }
            }
        }
    });
}

// Gráfico 2: Distribución de Préstamos (Dona)
function crearGraficoDistribucion() {
    const ctx = document.getElementById('graficoDistribucion');
    if (!ctx) return;
    
    if (graficosInstancia.distribucion) {
        graficosInstancia.distribucion.destroy();
    }
    
    const activos = prestamos.filter(p => p.estado === 'activo').length;
    const pagados = prestamos.filter(p => p.estado === 'pagado').length;
    
    graficosInstancia.distribucion = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Activos', 'Pagados'],
            datasets: [{
                data: [activos, pagados],
                backgroundColor: [
                    'rgba(37, 99, 235, 0.8)',
                    'rgba(16, 185, 129, 0.8)'
                ],
                borderColor: [
                    '#2563eb',
                    '#10b981'
                ],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

// Gráfico 3: Comparativa Préstamos vs Pagos (Barras)
function crearGraficoComparativa() {
    const ctx = document.getElementById('graficoComparativa');
    if (!ctx) return;
    
    if (graficosInstancia.comparativa) {
        graficosInstancia.comparativa.destroy();
    }
    
    const { labels, datasets } = prepararDatosComparativa();
    
    graficosInstancia.comparativa = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Préstamos Otorgados',
                    data: datasets.prestamos,
                    backgroundColor: 'rgba(37, 99, 235, 0.8)',
                    borderColor: '#2563eb',
                    borderWidth: 1,
                    borderRadius: 5
                },
                {
                    label: 'Pagos Recibidos',
                    data: datasets.pagos,
                    backgroundColor: 'rgba(16, 185, 129, 0.8)',
                    borderColor: '#10b981',
                    borderWidth: 1,
                    borderRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` $${context.parsed.y.toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '$' + value.toLocaleString();
                        }
                    }
                }
            }
        }
    });
}

// ============ FUNCIONES AUXILIARES PARA GRÁFICOS ============
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
    
    // Agrupar por día o mes según el período
    const pagosFiltrados = pagos.filter(p => 
        p.fecha >= fechaInicio && p.fecha <= fechaFin
    );
    
    if (periodoActual === 'mes') {
        // Agrupar por día
        const diasEnMes = new Date(fechaFin).getDate();
        for (let i = 1; i <= diasEnMes; i++) {
            const dia = i.toString().padStart(2, '0');
            labels.push(`Día ${dia}`);
            
            const totalDia = pagosFiltrados
                .filter(p => p.fecha.endsWith(`-${dia}`))
                .reduce((sum, p) => sum + p.monto, 0);
            datosIngresos.push(totalDia);
        }
    } else {
        // Agrupar por mes
        const mesesLabels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 
                            'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        
        const inicio = new Date(fechaInicio);
        const fin = new Date(fechaFin);
        
        for (let m = inicio.getMonth(); m <= fin.getMonth(); m++) {
            labels.push(mesesLabels[m]);
            
            const totalMes = pagosFiltrados.filter(p => {
                const fechaPago = new Date(p.fecha + 'T00:00:00');
                return fechaPago.getMonth() === m;
            }).reduce((sum, p) => sum + p.monto, 0);
            
            datosIngresos.push(totalMes);
        }
    }
    
    return {
        labels: labels,
        datasets: {
            ingresos: datosIngresos
        }
    };
}

function prepararDatosComparativa() {
    const { fechaInicio, fechaFin } = obtenerRangoFechas(periodoActual);
    let labels = [];
    let datosPrestamos = [];
    let datosPagos = [];
    
    if (periodoActual === 'mes') {
        // Por semana
        labels = ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4'];
        
        const inicio = new Date(fechaInicio + 'T00:00:00');
        
        for (let s = 0; s < 4; s++) {
            const inicioSemana = new Date(inicio);
            inicioSemana.setDate(inicio.getDate() + (s * 7));
            
            const finSemana = new Date(inicioSemana);
            finSemana.setDate(inicioSemana.getDate() + 6);
            
            const prestamosSemana = prestamos.filter(p => {
                const fecha = new Date(p.fechaInicio + 'T00:00:00');
                return fecha >= inicioSemana && fecha <= finSemana;
            }).reduce((sum, p) => sum + p.monto, 0);
            
            const pagosSemana = pagos.filter(p => {
                const fecha = new Date(p.fecha + 'T00:00:00');
                return fecha >= inicioSemana && fecha <= finSemana;
            }).reduce((sum, p) => sum + p.monto, 0);
            
            datosPrestamos.push(prestamosSemana);
            datosPagos.push(pagosSemana);
        }
    } else {
        // Por mes
        const mesesLabels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 
                            'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        
        const inicio = new Date(fechaInicio);
        const fin = new Date(fechaFin);
        
        for (let m = inicio.getMonth(); m <= fin.getMonth(); m++) {
            labels.push(mesesLabels[m]);
            
            const prestamosMes = prestamos.filter(p => {
                const fecha = new Date(p.fechaInicio + 'T00:00:00');
                return fecha.getMonth() === m;
            }).reduce((sum, p) => sum + p.monto, 0);
            
            const pagosMes = pagos.filter(p => {
                const fecha = new Date(p.fecha + 'T00:00:00');
                return fecha.getMonth() === m;
            }).reduce((sum, p) => sum + p.monto, 0);
            
            datosPrestamos.push(prestamosMes);
            datosPagos.push(pagosMes);
        }
    }
    
    return {
        labels: labels,
        datasets: {
            prestamos: datosPrestamos,
            pagos: datosPagos
        }
    };
}

// Actualizar gráficos cuando cambien los datos
function actualizarTodo() {
    actualizarEstadisticas();
    actualizarTablaPrestamos();
    actualizarTablaPagos();
    actualizarSelectPrestamos();
    actualizarGraficos(); // <- Nueva función
}
// ============ SISTEMA DE TICKETS ============

function generarTicket(pagoId) {
    const pago = pagos.find(p => p.id === pagoId);
    if (!pago) {
        alert('❌ Pago no encontrado');
        return;
    }
    
    const prestamo = prestamos.find(p => p.id === pago.prestamoId);
    if (!prestamo) {
        alert('❌ Préstamo no encontrado');
        return;
    }
    
    const saldoRestante = calcularSaldoRestante(prestamo.id);
    const ticketHTML = crearTicketHTML(pago, prestamo, saldoRestante);
    
    const container = document.getElementById('ticketContainer');
    container.innerHTML = ticketHTML;
    
    document.getElementById('ticketOverlay').classList.add('activo');
}

function crearTicketHTML(pago, prestamo, saldoRestante) {
    const numeroTicket = generarNumeroTicket(pago.id);
    const fechaPago = new Date(pago.fecha + 'T00:00:00');
    const fechaFormateada = fechaPago.toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    const horaFormateada = new Date().toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    // Calcular total pagado hasta ahora
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
                <div class="fila">
                    <span class="label">Fecha:</span>
                    <span class="value">${fechaFormateada}</span>
                </div>
                <div class="fila">
                    <span class="label">Hora:</span>
                    <span class="value">${horaFormateada}</span>
                </div>
                <div class="fila">
                    <span class="label">Cliente:</span>
                    <span class="value">${prestamo.cliente}</span>
                </div>
                <div class="fila">
                    <span class="label">Préstamo:</span>
                    <span class="value">${prestamo.motivo}</span>
                </div>
                <div class="fila">
                    <span class="label">Monto original:</span>
                    <span class="value">$${prestamo.monto.toLocaleString()}</span>
                </div>
                <div class="fila">
                    <span class="label">Cuota mensual:</span>
                    <span class="value">$${prestamo.cuotaMensual.toLocaleString()}</span>
                </div>
            </div>
            
            <div class="ticket-monto">
                <div class="monto-label">MONTO RECIBIDO</div>
                <div class="monto-recibido">$${pago.monto.toLocaleString()}</div>
                <small style="color: #64748b;">
                    ${pago.monto >= prestamo.cuotaMensual ? '✅ Pago completo' : '⚠️ Pago parcial'}
                </small>
            </div>
            
            <div class="ticket-info">
                <div class="fila">
                    <span class="label">Total pagado:</span>
                    <span class="value text-success">$${pagosAnteriores.toLocaleString()}</span>
                </div>
                <div class="fila">
                    <span class="label">Saldo pendiente:</span>
                    <span class="value text-danger">$${parseFloat(saldoRestante).toLocaleString()}</span>
                </div>
                <div class="fila">
                    <span class="label">Estado del préstamo:</span>
                    <span class="value">
                        ${prestamo.estado === 'activo' ? 
                            '<span style="color: #2563eb;">Activo</span>' : 
                            '<span style="color: #10b981;">Pagado</span>'}
                    </span>
                </div>
            </div>
            
            <div style="text-align: center; margin-top: 20px; padding: 10px; background: #f8fafc; border-radius: 10px;">
                <small style="color: #64748b;">
                    <i class="bi bi-check-circle text-success me-1"></i>
                    Pago registrado exitosamente
                </small>
            </div>
        </div>
        
        <div class="ticket-footer">
            <div>Este comprobante es válido como constancia de pago</div>
            <div>Gracias por su preferencia</div>
        </div>
        
        <div class="ticket-acciones">
            <button class="btn-imprimir" onclick="imprimirTicket()">
                <i class="bi bi-printer me-2"></i>Imprimir
            </button>
            <button class="btn-cerrar-ticket" onclick="cerrarTicket()">
                <i class="bi bi-x-lg me-2"></i>Cerrar
            </button>
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

function imprimirTicket() {
    window.print();
}

function cerrarTicket() {
    document.getElementById('ticketOverlay').classList.remove('activo');
}

// Cerrar ticket con ESC
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        cerrarTicket();
    }
});

// Cerrar ticket haciendo clic fuera
document.getElementById('ticketOverlay').addEventListener('click', function(e) {
    if (e.target === this) {
        cerrarTicket();
    }
});